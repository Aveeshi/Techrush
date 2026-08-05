const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

/*
  CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    roll_number TEXT,
    department TEXT,
    year INT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  This is the ONLY self-signup table. A student's role in any given
  event (attendee / volunteer / team head) is never stored here — it
  lives in event_registrations and team_heads. See design doc: role
  is contextual to an event, identity is not.
*/

class User {
  static async create({ name, email, password, rollNumber, department, year, phone }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO students (name, email, password_hash, roll_number, department, year, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, roll_number, department, year, phone, created_at`,
      [name, email, passwordHash, rollNumber, department, year, phone]
    );
    return rows[0];
  }

  static async findByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM students WHERE email = $1`, [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, email, roll_number, department, year, phone, created_at
       FROM students WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // For Google OAuth signups. Only ever called from the choose-role commit
  // step (never directly from the strategy) — by this point the person has
  // already picked "student" and filled every required field themselves,
  // so this is a full, complete insert, not a partial one.
  static async createFromGoogle({ name, email, googleId, rollNumber, department, year, phone }) {
    const { rows } = await pool.query(
      `INSERT INTO students (name, email, google_id, roll_number, department, year, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, google_id, roll_number, department, year, phone, created_at`,
      [name, email, googleId, rollNumber, department, year, phone]
    );
    return rows[0];
  }

  // All events this student has touched, across both roles (attendee/volunteer) —
  // powers the "my events" tab on the student dashboard
  static async getEventHistory(studentId) {
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.start_time, er.registration_type, er.status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.student_id = $1
       ORDER BY e.start_time DESC`,
      [studentId]
    );
    return rows;
  }

  // Every team this student has opted into (tech, content, etc.) — used to
  // build the "which task lists / chat channels do I see" query
  static async getTeams(studentId) {
    const { rows } = await pool.query(
      `SELECT tm.team_id, t.name, t.event_id
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.student_id = $1`,
      [studentId]
    );
    return rows;
  }

  // The real credited hours total: attendance='present' AND status='verified' only.
  // Self-reported 'completed' hours never appear here until an organizer verifies.
  static async getCreditedHours(studentId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(ta.hours_logged), 0) AS total_hours
       FROM task_assignments ta
       WHERE ta.student_id = $1
         AND ta.attendance = 'present'
         AND ta.status = 'verified'`,
      [studentId]
    );
    return Number(rows[0].total_hours);
  }
}

module.exports = User;