const crypto = require('crypto');
const pool = require('../utils/db');
const ClubMember = require('./ClubMember');

/*
  CREATE TABLE event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    registration_type TEXT CHECK (registration_type IN ('attendee','volunteer')) NOT NULL,
    qr_code TEXT UNIQUE,   -- opaque random check-in token, generated at registration time
    status TEXT CHECK (status IN ('registered','checked_in','checked_out','cancelled')) DEFAULT 'registered',
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, student_id)
  );

  qr_code is a random 40-char hex token, NOT the registration's own id —
  deliberately a separate secret so the row's UUID (which can leak into
  URLs/logs elsewhere) is never itself a valid check-in credential. The
  QR image encodes this token as plain text; AttendanceLog.scanQrCode()
  is what turns a decoded token into a check-in/check-out.

  The registration_type = 'volunteer' gate is enforced HERE, not just in
  the UI — canVolunteerForEvent() is re-checked server-side even if the
  frontend only shows the volunteer button to club members. A student
  could otherwise hit this endpoint directly and volunteer for a club
  they aren't in.
*/

class EventRegistration {
  static async create({ eventId, studentId, registrationType }) {
    if (registrationType === 'volunteer') {
      const allowed = await ClubMember.canVolunteerForEvent(studentId, eventId);
      if (!allowed) {
        throw new Error('You must be a member of the organizing club to volunteer for this event');
      }
    }

    const qrCode = crypto.randomBytes(20).toString('hex');

    const { rows } = await pool.query(
      `INSERT INTO event_registrations (event_id, student_id, registration_type, qr_code)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [eventId, studentId, registrationType, qrCode]
    );
    return rows[0];
  }

  // Used before showing the register/volunteer buttons — an already
  // registered student should see "you're registered" instead of the
  // form again, and the UNIQUE(event_id, student_id) constraint would
  // reject a second insert anyway.
  static async findByEventAndStudent(eventId, studentId) {
    const { rows } = await pool.query(
      `SELECT * FROM event_registrations WHERE event_id = $1 AND student_id = $2`,
      [eventId, studentId]
    );
    return rows[0] || null;
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

  static async cancel(eventId, studentId) {
    const { rows } = await pool.query(
      `UPDATE event_registrations
       SET status = 'cancelled'
       WHERE event_id = $1 AND student_id = $2
       RETURNING *`,
      [eventId, studentId]
    );
    return rows[0] || null;
  }
}

module.exports = EventRegistration;