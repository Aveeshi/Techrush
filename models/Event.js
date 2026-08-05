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
    created_at TIMESTAMPTZ DEFAULT now()
  );

  club_id vs organizer_id: an event belongs to the club (survives office-bearer
  turnover), but organizer_id records who specifically created it, matching
  how task_assignments.assigned_by tracks the specific team head, not just "the team."

  status vs visibility — two independent properties, don't conflate them:
  status is the event's WORKFLOW state (draft/published/ongoing/...).
  visibility is WHO CAN SEE a published event (everyone, or only club members).
  A meetup can be status='published' AND visibility='club_only' simultaneously.
*/

class Event {
  static async create({ clubId, organizerId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, visibility = 'public', registrationDeadline }) {
    const { rows } = await pool.query(
      `INSERT INTO events
        (club_id, organizer_id, event_type_id, title, description, venue, start_time, end_time, banner_url, visibility, registration_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [clubId, organizerId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, visibility, registrationDeadline]
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
  static async findForFeedWithDetails(studentId = null, { limit = 20, offset = 0 } = {}) {
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
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
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