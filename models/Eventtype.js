const pool = require('../utils/db');

/*
  CREATE TABLE event_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
  );

  A lookup table rather than free text on events.event_type_id, so
  filtering/search doesn't fracture across typo variants of the same
  category ("Hackathon" vs "hackathon" vs "Hack-a-thon").
*/

class EventType {
  static async create(name) {
    const { rows } = await pool.query(
      `INSERT INTO event_types (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [name]
    );
    return rows[0] || null;
  }

  static async findAll() {
    const { rows } = await pool.query(`SELECT * FROM event_types ORDER BY name`);
    return rows;
  }

  static async findByName(name) {
    const { rows } = await pool.query(`SELECT * FROM event_types WHERE name = $1`, [name]);
    return rows[0] || null;
  }
}

module.exports = EventType;