const crypto = require('crypto');
const pool = require('../utils/db');
const ClubMember = require('./Clubmember');

/*
  CREATE TABLE event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id),           -- exactly one of
    sub_event_id UUID REFERENCES sub_events(id),    -- these two is set
    student_id UUID REFERENCES students(id) NOT NULL,
    registration_type TEXT CHECK (registration_type IN ('attendee','volunteer')) NOT NULL,
    qr_code TEXT UNIQUE,   -- opaque random check-in token, generated at registration time
    status TEXT CHECK (status IN ('registered','checked_in','checked_out','cancelled')) DEFAULT 'registered',
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    CHECK ((event_id IS NOT NULL) <> (sub_event_id IS NOT NULL)),
    UNIQUE INDEX event_registrations_event_unique (event_id, student_id) WHERE event_id IS NOT NULL,
    UNIQUE INDEX event_registrations_subevent_unique (sub_event_id, student_id) WHERE sub_event_id IS NOT NULL
  );

  A registration belongs to EITHER a flagship event OR one of its
  sub-events, never both — same polymorphic shape as teams.sub_event_id
  and event_heads.sub_event_id. Every method below takes an optional
  { eventId, subEventId } pair (exactly one set) rather than assuming
  event_id, so a student registering/volunteering for a sub-event gets
  its own QR / its own team roster, entirely separate from the flagship's.

  qr_code is a random 40-char hex token, NOT the registration's own id —
  deliberately a separate secret so the row's UUID (which can leak into
  URLs/logs elsewhere) is never itself a valid check-in credential. The
  QR image encodes this token as plain text; AttendanceLog.scanQrCode()
  is what turns a decoded token into a check-in/check-out.

  qr_code is ONLY generated for registration_type='attendee'. Volunteers
  don't get a check-in QR at all — they get added straight to their chosen
  teams instead (see Team.addMember, driven from the event's "volunteer
  now" flow), no gate/entry check-in step for them.

  The registration_type = 'volunteer' gate is enforced HERE, not just in
  the UI — canVolunteerForEvent()/canVolunteerForSubEvent() is re-checked
  server-side even if the frontend only shows the volunteer button to club
  members. A student could otherwise hit this endpoint directly and
  volunteer for a club they aren't in.
*/

class EventRegistration {
  static async create({ eventId, subEventId, studentId, registrationType }) {
    if (!eventId === !subEventId) {
      throw new Error('EventRegistration.create requires exactly one of eventId or subEventId');
    }

    if (registrationType === 'volunteer') {
      const allowed = eventId
        ? await ClubMember.canVolunteerForEvent(studentId, eventId)
        : await ClubMember.canVolunteerForSubEvent(studentId, subEventId);
      if (!allowed) {
        throw new Error('You must be a member of the organizing club to volunteer for this event');
      }
    }

    // Attendees need a scannable entry code; volunteers don't (see note above).
    const qrCode = registrationType === 'attendee' ? crypto.randomBytes(20).toString('hex') : null;

    const { rows } = await pool.query(
      `INSERT INTO event_registrations (event_id, sub_event_id, student_id, registration_type, qr_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [eventId || null, subEventId || null, studentId, registrationType, qrCode]
    );
    return rows[0];
  }

  // Used before showing the register/volunteer buttons — an already
  // registered student should see "you're registered" instead of the
  // form again, and the partial unique index would reject a second
  // insert anyway.
  static async findByEventAndStudent(eventId, studentId) {
    const { rows } = await pool.query(
      `SELECT * FROM event_registrations WHERE event_id = $1 AND student_id = $2`,
      [eventId, studentId]
    );
    return rows[0] || null;
  }

  // Sub-event counterpart to findByEventAndStudent.
  static async findBySubEventAndStudent(subEventId, studentId) {
    const { rows } = await pool.query(
      `SELECT * FROM event_registrations WHERE sub_event_id = $1 AND student_id = $2`,
      [subEventId, studentId]
    );
    return rows[0] || null;
  }

  // Registered events (AND sub-events) for a student's dashboard, one
  // UNION ALL query so /registered-events only needs one call. Every row
  // carries event_id/sub_event_id (whichever applies, the other is null)
  // plus consistent title/venue/start_time/club_name columns regardless
  // of which kind of container it is. Pass registrationType to narrow to
  // 'attendee' or 'volunteer'; omit it to get both. Cancelled
  // registrations are excluded — they're no longer "registered for".
  static async findByStudent(studentId, registrationType = null) {
    const { rows } = await pool.query(
      `SELECT er.*, e.id AS parent_event_id, e.title, e.description, e.venue, e.start_time, e.end_time,
              e.banner_url, e.status AS event_status,
              et.name AS event_type_name, c.name AS club_name
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       LEFT JOIN event_types et ON et.id = e.event_type_id
       JOIN clubs c ON c.id = e.club_id
       WHERE er.event_id IS NOT NULL
         AND er.student_id = $1
         AND ($2::text IS NULL OR er.registration_type = $2)
         AND er.status != 'cancelled'

       UNION ALL

       SELECT er.*, e.id AS parent_event_id, se.title, se.description, se.venue, se.start_time, se.end_time,
              se.banner_url, se.status AS event_status,
              et.name AS event_type_name, c.name AS club_name
       FROM event_registrations er
       JOIN sub_events se ON se.id = er.sub_event_id
       JOIN events e ON e.id = se.event_id
       LEFT JOIN event_types et ON et.id = se.event_type_id
       JOIN clubs c ON c.id = e.club_id
       WHERE er.sub_event_id IS NOT NULL
         AND er.student_id = $1
         AND ($2::text IS NULL OR er.registration_type = $2)
         AND er.status != 'cancelled'

       ORDER BY start_time DESC`,
      [studentId, registrationType]
    );
    return rows;
  }

  static async findByEvent(eventId) {
    const { rows } = await pool.query(
      `SELECT er.*, s.name, s.email
       FROM event_registrations er
       JOIN students s ON s.id = er.student_id
       WHERE er.event_id = $1
       ORDER BY er.created_at`,
      [eventId]
    );
    return rows;
  }

  // Sub-event counterpart to findByEvent — the roster for one track.
  static async findBySubEvent(subEventId) {
    const { rows } = await pool.query(
      `SELECT er.*, s.name, s.email
       FROM event_registrations er
       JOIN students s ON s.id = er.student_id
       WHERE er.sub_event_id = $1
       ORDER BY er.created_at`,
      [subEventId]
    );
    return rows;
  }

  static async cancel({ eventId, subEventId }, studentId) {
    const { rows } = await pool.query(
      `UPDATE event_registrations
       SET status = 'cancelled'
       WHERE student_id = $3
         AND ($1::uuid IS NULL OR event_id = $1)
         AND ($2::uuid IS NULL OR sub_event_id = $2)
       RETURNING *`,
      [eventId || null, subEventId || null, studentId]
    );
    return rows[0] || null;
  }
}

module.exports = EventRegistration;
