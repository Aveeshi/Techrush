const pool = require('../utils/db');

/*
  Read-only queries that assemble the raw material for one student's CCA
  Activity Logbook, scoped to one club. Two independent activity sources
  feed the same logbook, matching what the club actually tracks:

    1. Verified task hours (task_assignments) — "title of the task
       completed". Same credited-hours gate as User.getCreditedHoursByClub:
       attendance='present' AND status='verified' only.
    2. Event check-ins (event_registrations, registration_type='attendee')
       — "event registered for as attendee and checked in for". Only rows
       with an actual checked_in_at count; a registration nobody ever
       showed up to isn't an activity that happened. A flagship event and
       each of its sub-events are separate registration rows (event_id XOR
       sub_event_id — see EventRegistration's schema note), so they land
       as separate logbook lines under their own titles, never merged.

  Neither source stores a clock-in/clock-out time explicitly, so the
  logbook builder (utils/logbookDocx.js) derives a displayed TIME RANGE
  from whichever timestamp each row does have (verified_at + hours_logged
  for tasks; checked_in_at/checked_out_at for events) — see that file for
  the actual formatting. The HOURS column is different for event rows:
  checked_out_at is usually never set (most events don't run an explicit
  checkout scan), so deriving hours from checked_in_at→checked_out_at
  would show 0/blank for nearly every attendee. credit_hours — the flat
  award the organizer configured on the event/sub-event, same value
  User.getCreditedHours* already uses — is the real hours-earned number,
  so it's selected here too and is what the docx builder credits.
*/

class LogbookData {
  // One row per verified task assignment, scoped to clubId via whichever
  // container (event or sub-event) the assignment's team belongs to — same
  // COALESCE-across-both-join-paths shape as User.getCreditedHoursByClub.
  static async getVerifiedTaskRows(studentId, clubId) {
    const { rows } = await pool.query(
      `SELECT t.title, t.description, ta.hours_logged, ta.verified_at AS timestamp,
              tm.name AS team_name
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN groups g ON g.id = t.group_id
       JOIN teams tm ON tm.id = g.team_id
       LEFT JOIN events e1 ON e1.id = tm.event_id
       LEFT JOIN sub_events se ON se.id = tm.sub_event_id
       LEFT JOIN events e2 ON e2.id = se.event_id
       WHERE ta.student_id = $1
         AND ta.attendance = 'present'
         AND ta.status = 'verified'
         AND COALESCE(e1.club_id, e2.club_id) = $2
       ORDER BY ta.verified_at ASC`,
      [studentId, clubId]
    );
    return rows;
  }

  // One row per event/sub-event the student attended as an attendee (i.e.
  // actually checked in) under this club. A registration only ever has one
  // of event_id/sub_event_id set, so a flagship event and each of its
  // sub-events each surface as their own row here, titled independently
  // (COALESCE just picks whichever of the two this row's container is —
  // never merges a sub-event into its parent's name). pe resolves a
  // sub-event's club_id through its parent event for the WHERE filter only.
  static async getAttendedEventRows(studentId, clubId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(e.title, se.title) AS title,
              COALESCE(e.description, se.description) AS description,
              COALESCE(e.credit_hours, se.credit_hours) AS credit_hours,
              er.checked_in_at, er.checked_out_at
       FROM event_registrations er
       LEFT JOIN events e ON e.id = er.event_id
       LEFT JOIN sub_events se ON se.id = er.sub_event_id
       LEFT JOIN events pe ON pe.id = se.event_id
       WHERE er.student_id = $1
         AND er.registration_type = 'attendee'
         AND er.checked_in_at IS NOT NULL
         AND COALESCE(e.club_id, pe.club_id) = $2
       ORDER BY er.checked_in_at ASC`,
      [studentId, clubId]
    );
    return rows;
  }
}

module.exports = LogbookData;
