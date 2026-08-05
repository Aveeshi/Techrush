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
}

module.exports = Club;