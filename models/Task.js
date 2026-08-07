const pool = require('../utils/db');

/*
  CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES groups(id) NOT NULL,   -- NOT team_id — groups are the task-bearing unit
    title TEXT NOT NULL,
    description TEXT,
    assigned_hours NUMERIC(4,1) NOT NULL,
    status TEXT CHECK (status IN ('open','assigned','in_progress','submitted','verified')) DEFAULT 'open',
    created_by UUID,
    created_by_type TEXT CHECK (created_by_type IN ('organizer','team_head')),
    due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Tasks attach to a group, not a team — each team has exactly one group
  (see Group.js), created together in Team.create(). To find tasks for a
  team, use findByTeam() below, which joins through groups for you.

  Authorization (creating/assigning tasks) still checks team-head status
  via Team.isTeamHead(teamId, studentId) — that check is unaffected by
  this change, since authority lives on the team, only tasks moved.

  This model intentionally does NOT track who's assigned or their
  hours/attendance/verification — that all lives in TaskAssignment,
  since one task can have many students each with their own status.
*/

class Task {
  // domainTags accepted for backwards-compat call sites but intentionally
  // unused/dropped — the live tasks table has no domain_tags column (the
  // schema comment above once described one that was never migrated in;
  // see also the matching fix in TaskAssignment.findByStudentAndTeam).
  static async create({ groupId, title, description, assignedHours, createdBy, createdByType, dueAt }) {
    const { rows } = await pool.query(
      `INSERT INTO tasks
        (group_id, title, description, assigned_hours, created_by, created_by_type, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [groupId, title, description, assignedHours, createdBy, createdByType, dueAt]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  static async findByGroup(groupId) {
    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE group_id = $1 ORDER BY due_at ASC`,
      [groupId]
    );
    return rows;
  }

  // Convenience for route handlers that only have teamId — joins through
  // groups internally so callers don't need to look up the group first.
  static async findByTeam(teamId) {
    const { rows } = await pool.query(
      `SELECT t.*
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       WHERE g.team_id = $1
       ORDER BY t.due_at ASC`,
      [teamId]
    );
    return rows;
  }

  // All open/assigned tasks visible to a student, across every team
  // they've joined — the "tech section + content section" dashboard view.
  // Joins team_members -> teams -> groups -> tasks.
  static async findForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT t.*, tm.team_id
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       JOIN team_members tm ON tm.team_id = g.team_id
       WHERE tm.student_id = $1
         AND t.status IN ('open', 'assigned')
       ORDER BY tm.team_id, t.due_at`,
      [studentId]
    );
    return rows;
  }

  static async updateStatus(id, status) {
    const { rows } = await pool.query(
      `UPDATE tasks SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0] || null;
  }
}

module.exports = Task;