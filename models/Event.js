const pool = require('../utils/db');

/*
  CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,       -- who the event belongs to
    organizer_id UUID REFERENCES organizers(id),        -- who actually created it (audit trail)
    event_type_id UUID REFERENCES event_types(id),       -- hackathon, meetup, mock interview, etc.
    title TEXT NOT NULL,
    description TEXT,
    venue TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    banner_url TEXT,
    status TEXT CHECK (status IN ('draft','published','ongoing','completed','cancelled')) DEFAULT 'draft',
    visibility TEXT CHECK (visibility IN ('public','club_only')) DEFAULT 'public',
    registration_deadline TIMESTAMPTZ,
    credit_hours NUMERIC(4,1),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  club_id vs organizer_id: an event belongs to the club (survives office-bearer
  turnover), but organizer_id records who specifically created it, matching
  how task_assignments.assigned_by tracks the specific team head, not just "the team."

  status vs visibility — two independent properties, don't conflate them:
  status is the event's WORKFLOW state (draft/published/ongoing/...).
  visibility is WHO CAN SEE a published event (everyone, or only club members).
  A meetup can be status='published' AND visibility='club_only' simultaneously.

  credit_hours is set by the organizer at creation time, exactly like a
  task's assigned_hours (see Task.js) — NULL means "attending this event
  earns no CCA hours" (the default; most events won't set it). When set, a
  student who registers as an ATTENDEE and actually checks in (event_
  registrations.checked_in_at IS NOT NULL) gets this flat amount credited —
  see User.getCreditedHours()/getHoursBreakdown(). It's a flat award, not
  hours-worked math: unlike task_assignments.hours_logged (which varies per
  student), everyone who attends the same event earns the same amount.
*/

class Event {
  // No auto-provisioned teams here — a fresh event starts with zero teams.
  // clubEventController.createEvent creates exactly one default team
  // (named after the event, headed by the event head if one's picked)
  // right after this call returns; that's a controller-level concern
  // since it needs eventHeadStudentId, which this model method never sees.
  static async create({ clubId, organizerId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, visibility = 'public', registrationDeadline, creditHours }) {
    const { rows } = await pool.query(
      `INSERT INTO events
        (club_id, organizer_id, event_type_id, title, description, venue, start_time, end_time, banner_url, visibility, registration_deadline, credit_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [clubId, organizerId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, visibility, registrationDeadline, creditHours || null]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM events WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  // Admin/internal use — ALL published events regardless of visibility.
  // Do NOT use this to render the student-facing event list; use
  // findVisibleTo() instead, or club_only meetups will leak to non-members.
  static async findPublished({ limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM events
       WHERE status = 'published'
       ORDER BY start_time ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  }

  // What a given student should actually see: public events, PLUS
  // club_only events for clubs they're a member of. This is the real
  // query behind the student event feed.
  static async findVisibleTo(studentId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT e.*
       FROM events e
       WHERE e.status = 'published'
         AND (
           e.visibility = 'public'
           OR (
             e.visibility = 'club_only'
             AND EXISTS (
               SELECT 1 FROM club_members cm
               WHERE cm.club_id = e.club_id AND cm.student_id = $1
             )
           )
         )
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    );
    return rows;
  }

  // Anonymous / logged-out visitors — public events only, no exceptions,
  // since there's no student_id to check club membership against.
  static async findPublicOnly({ limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM events
       WHERE status = 'published' AND visibility = 'public'
       ORDER BY start_time ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  }

  /*
    Card-view query for the event listing page — joins in event_type name
    and club name so the frontend doesn't need N+1 lookups per card. One
    method, branching on whether studentId is present, rather than two
    near-duplicate JOIN queries drifting apart over time.
  */
  // `q` (optional) narrows to events whose title, venue, or club name
  // contains the search term — case-insensitive substring match, which is
  // plenty for the events feed's search box; no need for full-text search
  // at this scale. Passed through as-is when absent ($4::text IS NULL
  // short-circuits the ILIKE checks entirely).
  static async findForFeedWithDetails(studentId = null, { limit = 20, offset = 0, q = null } = {}) {
    const { rows } = await pool.query(
      `SELECT e.*, et.name AS event_type_name, c.name AS club_name
       FROM events e
       LEFT JOIN event_types et ON et.id = e.event_type_id
       JOIN clubs c ON c.id = e.club_id
       WHERE e.status = 'published'
         AND (
           e.visibility = 'public'
           OR (
             $1::uuid IS NOT NULL
             AND e.visibility = 'club_only'
             AND EXISTS (
               SELECT 1 FROM club_members cm
               WHERE cm.club_id = e.club_id AND cm.student_id = $1
             )
           )
         )
         AND (
           $4::text IS NULL
           OR e.title ILIKE '%' || $4 || '%'
           OR e.venue ILIKE '%' || $4 || '%'
           OR c.name ILIKE '%' || $4 || '%'
         )
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [studentId, limit, offset, q]
    );
    return rows;
  }

  // Detail-view query for a single event page — same JOIN, one row.
  static async findByIdWithDetails(id) {
    const { rows } = await pool.query(
      `SELECT e.*, et.name AS event_type_name, c.name AS club_name, c.id AS club_id
       FROM events e
       LEFT JOIN event_types et ON et.id = e.event_type_id
       JOIN clubs c ON c.id = e.club_id
       WHERE e.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByType(eventTypeId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM events
       WHERE event_type_id = $1 AND status = 'published'
       ORDER BY start_time ASC
       LIMIT $2 OFFSET $3`,
      [eventTypeId, limit, offset]
    );
    return rows;
  }

  static async findByClub(clubId) {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE club_id = $1 ORDER BY start_time DESC`,
      [clubId]
    );
    return rows;
  }

  // Organizer editing an event's own info from the Club Events dashboard —
  // COALESCE means callers only need to pass whichever fields the edit
  // form actually changed.
  static async update(id, { title, description, venue, startTime, endTime, bannerUrl, eventTypeId, visibility, registrationDeadline, creditHours }) {
    const { rows } = await pool.query(
      `UPDATE events
       SET title = COALESCE($2, title),
           description = COALESCE($3, description),
           venue = COALESCE($4, venue),
           start_time = COALESCE($5, start_time),
           end_time = COALESCE($6, end_time),
           banner_url = COALESCE($7, banner_url),
           event_type_id = COALESCE($8, event_type_id),
           visibility = COALESCE($9, visibility),
           registration_deadline = COALESCE($10, registration_deadline),
           credit_hours = $11 -- NOT coalesced: unlike the other fields, an
                               -- empty submission here means "clear it",
                               -- not "leave unchanged" — the edit form
                               -- always sends this field, so a blank value
                               -- is a deliberate uncheck, not an omission.
       WHERE id = $1
       RETURNING *`,
      [id, title, description, venue, startTime, endTime, bannerUrl, eventTypeId, visibility, registrationDeadline, creditHours || null]
    );
    return rows[0] || null;
  }

  static async updateStatus(id, status) {
    const { rows } = await pool.query(
      `UPDATE events SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0] || null;
  }

  // Live counts for the organizer dashboard — checked-in vs total, split by role.
  // Feeds the Socket.io "dashboard" room on every check-in event.
  static async getAttendanceSummary(eventId) {
    const { rows } = await pool.query(
      `SELECT er.registration_type,
              COUNT(*) FILTER (WHERE er.status = 'checked_in') AS checked_in,
              COUNT(*) AS total_registered
       FROM event_registrations er
       WHERE er.event_id = $1
       GROUP BY er.registration_type`,
      [eventId]
    );
    return rows;
  }
}

module.exports = Event;