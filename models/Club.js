const pool = require('../utils/db');

/*
  CREATE TABLE clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Note: organizers.club_id references this table. A club can have
  multiple organizer accounts (office-bearers) — see Organizer.js.
*/

class Club {
  static async create({ name, description, logoUrl }) {
    const { rows } = await pool.query(
      `INSERT INTO clubs (name, description, logo_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description, logoUrl]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM clubs WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  static async findByName(name) {
    const { rows } = await pool.query(`SELECT * FROM clubs WHERE name = $1`, [name]);
    return rows[0] || null;
  }

  static async findAll() {
    const { rows } = await pool.query(`SELECT * FROM clubs ORDER BY name`);
    return rows;
  }

  static async update(id, { name, description, logoUrl }) {
    const { rows } = await pool.query(
      `UPDATE clubs
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           logo_url = COALESCE($4, logo_url)
       WHERE id = $1
       RETURNING *`,
      [id, name, description, logoUrl]
    );
    return rows[0] || null;
  }

  // Every organizer account tied to this club — used for RBAC checks
  // (e.g. "is this organizer allowed to create events for this club?")
  static async getOrganizers(clubId) {
    const { rows } = await pool.query(
      `SELECT id, name, email, created_at FROM organizers WHERE club_id = $1`,
      [clubId]
    );
    return rows;
  }

  static async getEvents(clubId) {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE club_id = $1 ORDER BY start_time DESC`,
      [clubId]
    );
    return rows;
  }

  // Organizer-side toggle on the club's dashboard — while off, students
  // never see this club as a logbook option at all (see
  // Club.findLogbookEnabledForStudent), regardless of membership.
  static async setLogbookEnabled(clubId, enabled) {
    const { rows } = await pool.query(
      `UPDATE clubs SET logbook_enabled = $2 WHERE id = $1 RETURNING *`,
      [clubId, !!enabled]
    );
    return rows[0] || null;
  }

  // Clubs a student can generate a logbook for: they're a member AND the
  // club's organizer has turned the feature on. This is the actual gate —
  // enforce it again server-side wherever a clubId is accepted from a form,
  // not just when rendering the picker.
  static async findLogbookEnabledForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT c.*
       FROM clubs c
       JOIN club_members cm ON cm.club_id = c.id
       WHERE cm.student_id = $1 AND c.logbook_enabled = true
       ORDER BY c.name`,
      [studentId]
    );
    return rows;
  }
}

module.exports = Club;