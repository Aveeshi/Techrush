const pool = require('../utils/db');

/*
  CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) NOT NULL,
    name TEXT NOT NULL,               -- e.g. "Tech", "Content"
    description TEXT,
    created_by UUID REFERENCES organizers(id),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(team_id, student_id)
  );

  CREATE TABLE team_heads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    assigned_by UUID REFERENCES organizers(id),
    assigned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(team_id, student_id)
  );

  team_heads is the actual authority grant. A row here — not any field on
  the student record — is what lets someone create/assign tasks and verify
  hours for that specific team. isTeamHead() below is the check every
  task-authoring route should run before letting a request through.
*/

class Team {
  // Creates the team AND its paired group in one transaction — a team can
  // never exist without its group, or vice versa, because this is the only
  // path either gets created through.
  static async create({ eventId, name, description, createdBy }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const teamResult = await client.query(
        `INSERT INTO teams (event_id, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [eventId, name, description, createdBy]
      );
      const team = teamResult.rows[0];

      const groupResult = await client.query(
        `INSERT INTO groups (team_id, name, created_by)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [team.id, name, createdBy]
      );

      await client.query('COMMIT');
      return { ...team, group: groupResult.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM teams WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  static async findByEvent(eventId) {
    const { rows } = await pool.query(
      `SELECT * FROM teams WHERE event_id = $1 ORDER BY name`,
      [eventId]
    );
    return rows;
  }

  // Volunteer self-serve join — no organizer/head approval needed at this level
  // (approval only kicks in at task-assignment acceptance, not team membership)
  static async addMember(teamId, studentId) {
    const { rows } = await pool.query(
      `INSERT INTO team_members (team_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (team_id, student_id) DO NOTHING
       RETURNING *`,
      [teamId, studentId]
    );
    return rows[0] || null;
  }

  static async removeMember(teamId, studentId) {
    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND student_id = $2`,
      [teamId, studentId]
    );
  }

  static async listMembers(teamId) {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.email, tm.joined_at
       FROM team_members tm
       JOIN students s ON s.id = tm.student_id
       WHERE tm.team_id = $1
       ORDER BY s.name`,
      [teamId]
    );
    return rows;
  }

  // Organizer promotes a volunteer to head — this INSERT is the entire
  // authority grant. Requires the student already be a team_member.
  static async assignHead(teamId, studentId, assignedByOrganizerId) {
    const isMember = await pool.query(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND student_id = $2`,
      [teamId, studentId]
    );
    if (!isMember.rows[0]) {
      throw new Error('Cannot assign head: student is not a member of this team');
    }

    const { rows } = await pool.query(
      `INSERT INTO team_heads (team_id, student_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, student_id) DO NOTHING
       RETURNING *`,
      [teamId, studentId, assignedByOrganizerId]
    );
    return rows[0] || null;
  }

  static async removeHead(teamId, studentId) {
    await pool.query(
      `DELETE FROM team_heads WHERE team_id = $1 AND student_id = $2`,
      [teamId, studentId]
    );
  }

  // The authorization check — call this before letting a student create a
  // task, assign a task, mark attendance, or verify hours for teamId.
  static async isTeamHead(teamId, studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM team_heads WHERE team_id = $1 AND student_id = $2`,
      [teamId, studentId]
    );
    return rows.length > 0;
  }

  static async getHeads(teamId) {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.email, th.assigned_at
       FROM team_heads th
       JOIN students s ON s.id = th.student_id
       WHERE th.team_id = $1`,
      [teamId]
    );
    return rows;
  }
}

module.exports = Team;