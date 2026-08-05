const pool = require('../utils/db');

/*
  CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Every team has exactly one group — this is where tasks actually attach.
  In normal usage you never call Group.create() directly; Team.create()
  creates the paired group in the same transaction, so this invariant
  can't be violated by forgetting a step. These read methods exist for
  looking the group up afterward.
*/

class Group {
  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM groups WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  // The common lookup: "I have a team_id, give me its group" —
  // needed anywhere you're creating/listing tasks for a team.
  static async findByTeam(teamId) {
    const { rows } = await pool.query(`SELECT * FROM groups WHERE team_id = $1`, [teamId]);
    return rows[0] || null;
  }
}

module.exports = Group;