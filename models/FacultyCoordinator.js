const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

class FacultyCoordinator {
  static async findByEmail(email) {
    const { rows } = await pool.query(
      `SELECT fc.*, c.name AS club_name, c.logo_url AS club_logo
       FROM faculty_coordinators fc
       LEFT JOIN clubs c ON c.id = fc.club_id
       WHERE LOWER(fc.email) = LOWER($1)`,
      [email]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT fc.*, c.name AS club_name, c.logo_url AS club_logo
       FROM faculty_coordinators fc
       LEFT JOIN clubs c ON c.id = fc.club_id
       WHERE fc.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByClub(clubId) {
    const { rows } = await pool.query(
      `SELECT fc.*, c.name AS club_name
       FROM faculty_coordinators fc
       LEFT JOIN clubs c ON c.id = fc.club_id
       WHERE fc.club_id = $1`,
      [clubId]
    );
    return rows[0] || null;
  }

  static async listAll() {
    const { rows } = await pool.query(
      `SELECT fc.id, fc.name, fc.email, fc.department, fc.designation, fc.phone,
              c.id AS club_id, c.name AS club_name
       FROM faculty_coordinators fc
       LEFT JOIN clubs c ON c.id = fc.club_id
       ORDER BY c.name ASC`
    );
    return rows;
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // Student Coordinators assignment by Faculty Coordinator
  static async assignStudentCoordinator({ clubId, studentId, assignedBy, roleTitle, taskDescription, canInspect = true }) {
    const { rows } = await pool.query(
      `INSERT INTO student_coordinators (club_id, student_id, assigned_by, role_title, task_description, can_inspect_records)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (club_id, student_id)
       DO UPDATE SET role_title = EXCLUDED.role_title,
                     task_description = EXCLUDED.task_description,
                     assigned_by = EXCLUDED.assigned_by,
                     can_inspect_records = EXCLUDED.can_inspect_records
       RETURNING *`,
      [clubId, studentId, assignedBy, roleTitle || 'Student Coordinator', taskDescription || null, canInspect]
    );
    return rows[0];
  }

  static async removeStudentCoordinator(clubId, studentId) {
    await pool.query(
      `DELETE FROM student_coordinators WHERE club_id = $1 AND student_id = $2`,
      [clubId, studentId]
    );
    return true;
  }

  static async getStudentCoordinators(clubId) {
    const { rows } = await pool.query(
      `SELECT sc.*, s.name AS student_name, s.email AS student_email, s.roll_number,
              s.department, s.year, s.profile_photo_url,
              fc.name AS assigned_by_name
       FROM student_coordinators sc
       JOIN students s ON s.id = sc.student_id
       LEFT JOIN faculty_coordinators fc ON fc.id = sc.assigned_by
       WHERE sc.club_id = $1
       ORDER BY sc.created_at DESC`,
      [clubId]
    );
    return rows;
  }

  static async isStudentCoordinator(studentId, clubId = null) {
    let query = `SELECT sc.*, c.name AS club_name FROM student_coordinators sc JOIN clubs c ON c.id = sc.club_id WHERE sc.student_id = $1`;
    const params = [studentId];
    if (clubId) {
      query += ` AND sc.club_id = $2`;
      params.push(clubId);
    }
    const { rows } = await pool.query(query, params);
    return rows;
  }
}

module.exports = FacultyCoordinator;
