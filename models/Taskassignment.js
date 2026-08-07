const pool = require('../utils/db');

/*
  CREATE TABLE task_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id),
    student_id UUID REFERENCES students(id),
    assigned_by UUID REFERENCES students(id),   -- the head's student_id — NOT a FK to team_heads
                                                  -- (see note below on why)
    attendance TEXT CHECK (attendance IN ('present','absent')) DEFAULT NULL,
    marked_by UUID REFERENCES students(id),
    marked_at TIMESTAMPTZ,
    status TEXT CHECK (status IN ('pending','accepted','in_progress','completed','verified','rejected')) DEFAULT 'pending',
    hours_logged NUMERIC(4,1),
    submitted_at TIMESTAMPTZ,
    verified_by UUID,                        -- either a team_head's student_id or an organizer_id
    verified_by_type TEXT CHECK (verified_by_type IN ('organizer','team_head')),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(task_id, student_id)
  );

  Why assigned_by/marked_by reference students(id) and NOT team_heads:
  (1) team_heads.student_id alone isn't unique — a student can head
      multiple teams, only the (team_id, student_id) pair is unique, so
      Postgres won't allow an FK against student_id alone.
  (2) Even if it could, hard-linking to team_heads would mean demoting a
      head (deleting their team_heads row) either cascades and destroys
      the historical "who assigned this" record, or blocks the demotion
      entirely. Neither is right — history should outlive the grant.
  (3) The real rule — "was this student head of THIS task's specific
      team at assignment time" — is a contextual, cross-table check a
      plain FK can't express anyway. That's enforced in application code
      via Team.isTeamHead(teamId, studentId) before every insert/update
      below, not by the database schema.

  This is the real workhorse of the whole hours/verification system.
  One row per (task, student) pair — never store student_id as an array,
  each student needs independent status/attendance/hours.

  Full lifecycle per student, in order:
  1. assignBulk()      -> status='pending', attendance=NULL
  2. markAttendance()  -> attendance='present' | 'absent'  (team head, ran the task)
  3. markCompleted()   -> status='completed' (BLOCKED if attendance != 'present')
  4. verify()          -> status='verified' (team head for their own team, OR organizer as override/audit)

  Hours only ever count if attendance='present' AND status='verified' —
  see User.getCreditedHours() for the actual gated query.

  NOTE: verified_by no longer has a hard FK, since it can point to either
  students(id) (a team head) or organizers(id). Enforce validity at the
  application layer via Team.isTeamHead() before calling verify() — see
  Team.js.
*/

class TaskAssignment {
  // Team head assigns a task to multiple students in one call.
  // ON CONFLICT DO NOTHING makes this safe to re-run if a student is already assigned.
  static async assignBulk(taskId, studentIds, assignedBy) {
    if (!studentIds.length) return [];

    const valuesSql = studentIds
      .map((_, i) => `($1, $${i + 2}, $${studentIds.length + 2})`)
      .join(', ');

    const { rows } = await pool.query(
      `INSERT INTO task_assignments (task_id, student_id, assigned_by)
       VALUES ${valuesSql}
       ON CONFLICT (task_id, student_id) DO NOTHING
       RETURNING *`,
      [taskId, ...studentIds, assignedBy]
    );
    return rows;
  }

  // Full roster for a task, with student names joined in — this is what
  // renders the team head's checklist UI.
  static async findByTask(taskId) {
    const { rows } = await pool.query(
      `SELECT ta.*, s.name, s.email
       FROM task_assignments ta
       JOIN students s ON s.id = ta.student_id
       WHERE ta.task_id = $1
       ORDER BY s.name`,
      [taskId]
    );
    return rows;
  }

  // Every task assigned to a given student, across all teams
  static async findByStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT ta.*, t.title, t.team_id, t.due_at
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.student_id = $1
       ORDER BY t.due_at`,
      [studentId]
    );
    return rows;
  }

  // Tasks assigned to a specific student, scoped to one team — this is the
  // "my tasks" list on that team's page. Joins through groups since tasks
  // attach to the group, not directly to the team (see Task.js).
  static async findByStudentAndTeam(teamId, studentId) {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.assigned_hours,
              t.due_at, t.status AS task_status,
              ta.status AS my_status, ta.attendance, ta.hours_logged,
              ta.submitted_at, ta.verified_at
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN groups g ON g.id = t.group_id
       WHERE g.team_id = $1 AND ta.student_id = $2
       ORDER BY t.due_at ASC NULLS LAST`,
      [teamId, studentId]
    );
    return rows;
  }

  // Team head's checklist submission — bulk present/absent in one call.
  // studentIds should be just the ones being marked with this attendanceValue;
  // call twice (once for present, once for absent) from the route handler.
  static async markAttendance(taskId, studentIds, attendanceValue, markedBy) {
    if (!['present', 'absent'].includes(attendanceValue)) {
      throw new Error(`Invalid attendance value: ${attendanceValue}`);
    }
    const { rows } = await pool.query(
      `UPDATE task_assignments
       SET attendance = $3, marked_by = $4, marked_at = now()
       WHERE task_id = $1 AND student_id = ANY($2::uuid[])
       RETURNING *`,
      [taskId, studentIds, attendanceValue, markedBy]
    );
    return rows;
  }

  // Student self-reports completion. Fails loudly if they weren't marked
  // present — prevents a confusing state where an absent student "completes"
  // a task, forcing the organizer to catch it manually at verification.
  static async markCompleted(taskId, studentId, hoursLogged) {
    const { rows } = await pool.query(
      `UPDATE task_assignments
       SET status = 'completed', hours_logged = $3, submitted_at = now()
       WHERE task_id = $1 AND student_id = $2 AND attendance = 'present'
       RETURNING *`,
      [taskId, studentId, hoursLogged]
    );
    if (!rows[0]) {
      throw new Error('Cannot mark completed: student was not marked present for this task');
    }
    return rows[0];
  }

  // Marks hours as counted — the only action that makes them count.
  // verifierType is 'team_head' or 'organizer'. Callers MUST authorize first:
  // for 'team_head', check Team.isTeamHead(teamId, verifierId) before calling this.
  // Organizers can verify any task under their club as an override/audit path.
  static async verify(taskId, studentId, verifierId, verifierType) {
    if (!['team_head', 'organizer'].includes(verifierType)) {
      throw new Error(`Invalid verifierType: ${verifierType}`);
    }
    const { rows } = await pool.query(
      `UPDATE task_assignments
       SET status = 'verified', verified_by = $3, verified_by_type = $4, verified_at = now()
       WHERE task_id = $1 AND student_id = $2 AND status = 'completed'
       RETURNING *`,
      [taskId, studentId, verifierId, verifierType]
    );
    if (!rows[0]) {
      throw new Error('Cannot verify: this student\'s task is not in completed state');
    }
    return rows[0];
  }

  // The team-head "mark complete" action — ONE step, replacing the old
  // self-report -> verify pipeline entirely for tasks created after this
  // feature: the head presses "mark complete" on a task, picks who
  // actually showed up in a popup, and submits. Whoever's checked gets
  // attendance='present' + the task's full assigned_hours credited +
  // status='verified' immediately (no separate student action, no
  // separate verify() call); everyone else assigned gets
  // attendance='absent' and stays wherever their status already was.
  // presentIds/absentIds together should cover every assignee — the
  // caller (teamController.completeTask) derives absentIds as "assigned
  // minus present".
  static async markAttendanceAndVerify(taskId, { presentIds, absentIds }, assignedHours, verifierId, verifierType) {
    if (!['team_head', 'organizer'].includes(verifierType)) {
      throw new Error(`Invalid verifierType: ${verifierType}`);
    }
    if (presentIds.length) {
      await pool.query(
        `UPDATE task_assignments
         SET attendance = 'present',
             hours_logged = $3,
             status = 'verified',
             submitted_at = now(),
             verified_by = $4,
             verified_by_type = $5,
             verified_at = now()
         WHERE task_id = $1 AND student_id = ANY($2::uuid[])`,
        [taskId, presentIds, assignedHours, verifierId, verifierType]
      );
    }
    if (absentIds.length) {
      await pool.query(
        `UPDATE task_assignments
         SET attendance = 'absent', marked_by = $3, marked_at = now()
         WHERE task_id = $1 AND student_id = ANY($2::uuid[])`,
        [taskId, absentIds, verifierId]
      );
    }
  }

  // Tasks stuck at 'completed' and never verified — for an organizer reminder job.
  // Joins tasks -> groups -> teams -> events, since tasks attach to groups now.
  static async findPendingVerification(clubId) {
    const { rows } = await pool.query(
      `SELECT ta.*, t.title, s.name AS student_name
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN groups g ON g.id = t.group_id
       JOIN teams tm ON tm.id = g.team_id
       JOIN events e ON e.id = tm.event_id
       JOIN students s ON s.id = ta.student_id
       WHERE e.club_id = $1 AND ta.status = 'completed'
       ORDER BY ta.submitted_at ASC`,
      [clubId]
    );
    return rows;
  }
}

module.exports = TaskAssignment;