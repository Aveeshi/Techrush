const pool = require('../utils/db');
const EventHead = require('./EventHead');
const SubEvent = require('./SubEvent');
const Event = require('./Event');

/*
  CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id),           -- exactly one of
    sub_event_id UUID REFERENCES sub_events(id),   -- these two is set
    name TEXT NOT NULL,               -- e.g. "Tech", "Content"
    description TEXT,
    created_by UUID REFERENCES organizers(id),
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CHECK ((event_id IS NOT NULL) <> (sub_event_id IS NOT NULL))

  A team belongs to EITHER a top-level event OR a sub-event, never both
  — a flagship's own teams (event_id set) and one of its tracks' teams
  (sub_event_id set) are both just "teams" as far as team_members,
  team_heads, tasks, and chat are concerned. Everything below team level
  (isMember, isTeamHead, assignHead, listMembers, and every method in
  Task.js/TaskAssignment.js/Chat.js) keys off team_id directly and never
  needs to know which kind of parent a team has — only the container-scoped
  listing methods (findByEvent/findBySubEvent) do.

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
  // path either gets created through. Pass exactly one of eventId/subEventId.
  static async create({ eventId, subEventId, name, description, createdBy }) {
    if (!eventId === !subEventId) {
      throw new Error('Team.create requires exactly one of eventId or subEventId');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const teamResult = await client.query(
        `INSERT INTO teams (event_id, sub_event_id, name, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [eventId || null, subEventId || null, name, description, createdBy]
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

  // Sub-event counterpart to findByEvent — a track's own teams.
  static async findBySubEvent(subEventId) {
    const { rows } = await pool.query(
      `SELECT * FROM teams WHERE sub_event_id = $1 ORDER BY name`,
      [subEventId]
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
      `SELECT s.id, s.name, s.email, s.year, s.department, tm.joined_at
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

  // Plain membership check (no authority implied) — gates access to a
  // team's task list / group chat page, as opposed to isTeamHead() below
  // which gates the ability to create/assign/verify.
  static async isMember(teamId, studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND student_id = $2`,
      [teamId, studentId]
    );
    return rows.length > 0;
  }

  // The actual gate for a team's chat/task-list page (teamController.
  // teamDetail/postChatMessage/chatMessagesJson, and the matching
  // sockets/chatSocket.js handlers) — broader than plain isMember: an
  // event head should be able to open and post in EVERY team's chat
  // under their event/sub-event, not just teams they happen to be a
  // literal team_members row on (Team.assignHead already guarantees a
  // team head is always a member too, so isMember alone still covers
  // that case — this only adds the event-head branch on top). For a
  // team under a sub-event, that check is hierarchical (see EventHead.
  // isEventHeadOfSubEvent) — a MAIN event head gets chat access to every
  // team under every one of their sub-events too, not just their own
  // flagship's teams.
  //
  // Takes the full { id, type, club_id } user, not just a student id — the
  // organizer who owns the team's club sits at the TOP of this hierarchy
  // (organizer > event head > team head), so they get the same access an
  // event head does, just scoped by club rather than by event-head row.
  static async canAccessTeam(teamId, user) {
    const team = await Team.findById(teamId);
    if (!team) return false;

    if (user.type === 'organizer') {
      const clubId = team.event_id
        ? (await Event.findById(team.event_id))?.club_id
        : (await SubEvent.findByIdWithDetails(team.sub_event_id))?.club_id;
      return !!clubId && user.club_id === clubId;
    }

    if (await Team.isMember(teamId, user.id)) return true;
    if (team.event_id) {
      return EventHead.isEventHead({ eventId: team.event_id }, user.id);
    }
    const subEvent = await SubEvent.findById(team.sub_event_id);
    return subEvent ? EventHead.isEventHeadOfSubEvent(subEvent, user.id) : false;
  }

  // Every team a student volunteers on, across every event — powers the
  // student-facing "Teams" page (one card per team).
  static async findByStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT t.*, e.title AS event_title, e.start_time AS event_start_time
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN events e ON e.id = t.event_id
       WHERE tm.student_id = $1
       ORDER BY e.start_time DESC`,
      [studentId]
    );
    return rows;
  }

  // One row per EVENT the student volunteers at (not per team) — the top
  // level of the "Teams" page. A student who joined 3 of an event's 5
  // teams sees that event once here, with team_count = 3; drilling into
  // it (findByStudentAndEvent) is what shows the 3 individual team cards.
  static async findEventsForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT e.id AS event_id, e.title AS event_title, e.banner_url,
              e.start_time AS event_start_time, c.name AS club_name,
              COUNT(DISTINCT t.id) AS team_count
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN events e ON e.id = t.event_id
       JOIN clubs c ON c.id = e.club_id
       WHERE tm.student_id = $1
       GROUP BY e.id, e.title, e.banner_url, e.start_time, c.name
       ORDER BY e.start_time DESC`,
      [studentId]
    );
    return rows;
  }

  // Just the teams (within one event) a student has joined — the second
  // level of the "Teams" page, and also used to pre-check the volunteer
  // team-picker on the event page itself.
  static async findByStudentAndEvent(eventId, studentId) {
    const { rows } = await pool.query(
      `SELECT t.*
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE t.event_id = $1 AND tm.student_id = $2
       ORDER BY t.name`,
      [eventId, studentId]
    );
    return rows;
  }

  // Sub-event counterpart to findEventsForStudent — one row per SUB-EVENT
  // the student volunteers at, for its own card on the "Teams" page.
  static async findSubEventsForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT se.id AS sub_event_id, se.title AS sub_event_title, se.banner_url,
              se.start_time AS sub_event_start_time, se.event_id, c.name AS club_name,
              COUNT(DISTINCT t.id) AS team_count
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN sub_events se ON se.id = t.sub_event_id
       JOIN events e ON e.id = se.event_id
       JOIN clubs c ON c.id = e.club_id
       WHERE tm.student_id = $1
       GROUP BY se.id, se.title, se.banner_url, se.start_time, se.event_id, c.name
       ORDER BY se.start_time DESC`,
      [studentId]
    );
    return rows;
  }

  // Sub-event counterpart to findByStudentAndEvent.
  static async findByStudentAndSubEvent(subEventId, studentId) {
    const { rows } = await pool.query(
      `SELECT t.*
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE t.sub_event_id = $1 AND tm.student_id = $2
       ORDER BY t.name`,
      [subEventId, studentId]
    );
    return rows;
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

  // Cheap existence check for the nav badge/role-flag middleware.
  static async isHeadOfAny(studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM team_heads WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    return rows.length > 0;
  }

  // Every team this student heads — powers the "My Events & Teams" page's
  // TEAM HEAD tag. Container title/type/start_time/club_name comes from
  // whichever of event_id/sub_event_id is set, mirroring
  // findEventsForStudent's shape but keyed off team_heads instead of
  // team_members. e2/se's own parent event is what club_name resolves
  // through for the sub-event branch.
  static async findHeadedByStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT t.*,
              COALESCE(e.title, se.title) AS container_title,
              COALESCE(e.start_time, se.start_time) AS container_start_time,
              COALESCE(c1.name, c2.name) AS club_name,
              se.event_id AS sub_event_parent_id,
              CASE WHEN t.event_id IS NOT NULL THEN 'event' ELSE 'sub_event' END AS container_type
       FROM team_heads th
       JOIN teams t ON t.id = th.team_id
       LEFT JOIN events e ON e.id = t.event_id
       LEFT JOIN clubs c1 ON c1.id = e.club_id
       LEFT JOIN sub_events se ON se.id = t.sub_event_id
       LEFT JOIN events e2 ON e2.id = se.event_id
       LEFT JOIN clubs c2 ON c2.id = e2.club_id
       WHERE th.student_id = $1
       ORDER BY t.name`,
      [studentId]
    );
    return rows;
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