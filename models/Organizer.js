const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

/*
  CREATE TABLE organizers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Why this exists separately from Club: the club is the entity events
  belong to, but a club can't itself hold a login. Organizer is the
  real account a person logs in with — an office-bearer acting on
  behalf of their club_id. This is what event.organizer_id and
  task_assignments.verified_by actually point to.
*/

class Organizer {
  static async create({ name, email, password, clubId }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO organizers (name, email, password_hash, club_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, club_id, created_at`,
      [name, email, passwordHash, clubId]
    );
    return rows[0];
  }

  // Includes password_hash — used only internally by the login route,
  // never returned to the client directly.
  static async findByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM organizers WHERE email = $1`, [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, email, club_id, created_at FROM organizers WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // For Google OAuth signups, committed from the choose-role step after the
  // person has selected the organizer tab and picked/created their club.
  static async createFromGoogle({ name, email, googleId, clubId }) {
    const { rows } = await pool.query(
      `INSERT INTO organizers (name, email, google_id, club_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, club_id, created_at`,
      [name, email, googleId, clubId]
    );
    return rows[0];
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // All events this organizer has created, regardless of current status
  static async getEvents(organizerId) {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE organizer_id = $1 ORDER BY start_time DESC`,
      [organizerId]
    );
    return rows;
  }
}

module.exports = Organizer;