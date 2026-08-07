const pool = require('../utils/db');

/*
  CREATE TABLE event_heads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id),
    sub_event_id UUID REFERENCES sub_events(id),
    student_id UUID REFERENCES students(id) NOT NULL,
    assigned_by UUID REFERENCES organizers(id) NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    CHECK ((event_id IS NOT NULL) <> (sub_event_id IS NOT NULL))
  );
  UNIQUE INDEX event_heads_event_unique ON event_heads(event_id, student_id) WHERE event_id IS NOT NULL;
  UNIQUE INDEX event_heads_subevent_unique ON event_heads(sub_event_id, student_id) WHERE sub_event_id IS NOT NULL;

  Event Head is a STUDENT role, distinct from both team_head (runs one
  team) and organizer (runs the whole club). An event head runs one
  specific event or sub-event: creates its teams, assigns its team
  heads, edits its info, and can assign tasks directly (same authority a
  team head has, but for every team under their event/sub-event, not
  just one). Same polymorphic shape as teams.sub_event_id — exactly one
  of event_id/sub_event_id is set per row.

  Assignment is organizer-only (assigned_by is always an organizer, never
  another event head) — an event head can't appoint co-heads or hand off
  their own role. A student can head unlimited events/sub-events at once,
  same as team_heads has no per-student cap.
*/

class EventHead {
  static async assign({ eventId, subEventId, studentId, assignedBy }) {
    if (!eventId === !subEventId) {
      throw new Error('EventHead.assign requires exactly one of eventId or subEventId');
    }
    const { rows } = await pool.query(
      `INSERT INTO event_heads (event_id, sub_event_id, student_id, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [eventId || null, subEventId || null, studentId, assignedBy]
    );
    return rows[0] || null;
  }

  static async remove({ eventId, subEventId, studentId }) {
    await pool.query(
      `DELETE FROM event_heads
       WHERE student_id = $3
         AND ($1::uuid IS NULL OR event_id = $1)
         AND ($2::uuid IS NULL OR sub_event_id = $2)`,
      [eventId || null, subEventId || null, studentId]
    );
  }

  // The authorization check — call before letting a student create a team,
  // assign a team head, edit event info, or author a task for any team
  // under this event/sub-event.
  static async isEventHead({ eventId, subEventId }, studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM event_heads
       WHERE student_id = $3
         AND ($1::uuid IS NULL OR event_id = $1)
         AND ($2::uuid IS NULL OR sub_event_id = $2)`,
      [eventId || null, subEventId || null, studentId]
    );
    return rows.length > 0;
  }

  // Hierarchical authority: the MAIN (flagship) event head automatically
  // gets every authority a sub-event's OWN head has, for every sub-event
  // under their event — teams, tasks, chat, QR scan, attendees, all of
  // it. Every place that gates on "is this student head of THIS
  // sub-event" should go through this instead of a bare isEventHead call,
  // so that inheritance is enforced in exactly one place. subEvent needs
  // .id and .event_id (its parent) — every subEvent row already carries
  // both (SubEvent.findById/findByIdWithDetails).
  static async isEventHeadOfSubEvent(subEvent, studentId) {
    const [isOwnHead, isParentHead] = await Promise.all([
      EventHead.isEventHead({ subEventId: subEvent.id }, studentId),
      EventHead.isEventHead({ eventId: subEvent.event_id }, studentId),
    ]);
    return isOwnHead || isParentHead;
  }

  // Cheap existence check for the nav badge/role-flag middleware — is this
  // student head of ANYTHING at all, regardless of which event/sub-event.
  static async isHeadOfAny(studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM event_heads WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    return rows.length > 0;
  }

  // Every event/sub-event this student heads — powers the "My Events" tab.
  // One UNION so the controller doesn't need two round trips; type tells
  // the view/controller which table (and therefore which detail URL) a
  // given row belongs to.
  static async findContainersForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT 'event' AS type, e.id, NULL::uuid AS parent_event_id, e.title, e.start_time, c.name AS club_name
       FROM event_heads eh
       JOIN events e ON e.id = eh.event_id
       JOIN clubs c ON c.id = e.club_id
       WHERE eh.student_id = $1 AND eh.event_id IS NOT NULL

       UNION ALL

       SELECT 'sub_event' AS type, se.id, se.event_id AS parent_event_id, se.title, se.start_time, c.name AS club_name
       FROM event_heads eh
       JOIN sub_events se ON se.id = eh.sub_event_id
       JOIN events e ON e.id = se.event_id
       JOIN clubs c ON c.id = e.club_id
       WHERE eh.student_id = $1 AND eh.sub_event_id IS NOT NULL

       ORDER BY start_time DESC`,
      [studentId]
    );
    return rows;
  }

  static async listFor({ eventId, subEventId }) {
    const { rows } = await pool.query(
      `SELECT eh.*, s.name, s.email
       FROM event_heads eh
       JOIN students s ON s.id = eh.student_id
       WHERE ($1::uuid IS NULL OR eh.event_id = $1)
         AND ($2::uuid IS NULL OR eh.sub_event_id = $2)
       ORDER BY s.name`,
      [eventId || null, subEventId || null]
    );
    return rows;
  }
}

module.exports = EventHead;
