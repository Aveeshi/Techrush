const pool = require('../utils/db');

/*
  CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID REFERENCES event_registrations(id) NOT NULL,
    action TEXT CHECK (action IN ('check_in','check_out')) NOT NULL,
    scanned_by UUID,          -- organizer or head whose device did the QR scan
    scanned_at TIMESTAMPTZ DEFAULT now(),
    method TEXT DEFAULT 'qr'
  );

  Append-only log, not two nullable timestamp columns on event_registrations.
  Reasons: volunteers may check in/out multiple times per shift, this gives
  a real audit trail, and the live dashboard just does COUNT queries against
  this table instead of diffing nullable columns.

  This is EVENT-level attendance (did they show up to the event at all) —
  distinct from task_assignments.attendance, which is per-task attendance
  taken by a team head. A volunteer can be checked in to the event but
  marked absent for a specific task they were assigned (e.g. they showed up
  but didn't do that particular task).
*/

class AttendanceLog {
  static async logAction(registrationId, action, scannedBy, method = 'qr') {
    if (!['check_in', 'check_out'].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    const { rows } = await pool.query(
      `INSERT INTO attendance_logs (registration_id, action, scanned_by, method)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [registrationId, action, scannedBy, method]
    );
    return rows[0];
  }

  static async getLogsForRegistration(registrationId) {
    const { rows } = await pool.query(
      `SELECT * FROM attendance_logs WHERE registration_id = $1 ORDER BY scanned_at`,
      [registrationId]
    );
    return rows;
  }

  // What's their current state — used to decide whether the next QR scan
  // should be treated as a check-in or a check-out (toggle behavior)
  static async getLastAction(registrationId) {
    const { rows } = await pool.query(
      `SELECT action FROM attendance_logs
       WHERE registration_id = $1
       ORDER BY scanned_at DESC
       LIMIT 1`,
      [registrationId]
    );
    return rows[0]?.action || null;
  }

  // The actual QR scan handler — called from the organizer's scan page
  // with whatever string the camera just decoded. Toggles check_in/check_out
  // based on getLastAction()'s logic, but does it as one atomic transaction
  // (SELECT ... FOR UPDATE locks the registration row) so two near-simultaneous
  // scans of the same code can't both read "not checked in yet" and both
  // insert a check_in.
  //
  // eventId is passed in and checked against the registration's own event_id
  // so a QR code issued for Event A can't be walked up to Event B's scanner
  // and checked in there.
  static async scanQrCode(qrCode, eventId, scannedBy) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const regResult = await client.query(
        `SELECT er.*, s.name, s.email
         FROM event_registrations er
         JOIN students s ON s.id = er.student_id
         WHERE er.qr_code = $1
         FOR UPDATE OF er`,
        [qrCode]
      );
      const registration = regResult.rows[0];

      if (!registration) {
        throw new Error('QR_NOT_FOUND');
      }
      if (registration.event_id !== eventId) {
        throw new Error('WRONG_EVENT');
      }
      if (registration.status === 'cancelled') {
        throw new Error('REGISTRATION_CANCELLED');
      }

      const lastResult = await client.query(
        `SELECT action FROM attendance_logs
         WHERE registration_id = $1
         ORDER BY scanned_at DESC LIMIT 1`,
        [registration.id]
      );
      const action = lastResult.rows[0]?.action === 'check_in' ? 'check_out' : 'check_in';

      await client.query(
        `INSERT INTO attendance_logs (registration_id, action, scanned_by, method)
         VALUES ($1, $2, $3, 'qr')`,
        [registration.id, action, scannedBy]
      );

      const status = action === 'check_in' ? 'checked_in' : 'checked_out';
      const timestampColumn = action === 'check_in' ? 'checked_in_at' : 'checked_out_at';
      const updateResult = await client.query(
        `UPDATE event_registrations
         SET status = $1, ${timestampColumn} = now()
         WHERE id = $2
         RETURNING *`,
        [status, registration.id]
      );

      await client.query('COMMIT');
      return {
        action,
        registration: { ...updateResult.rows[0], name: registration.name, email: registration.email },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Live counts for the organizer dashboard, split by attendee/volunteer —
  // call this after every scan and push the result over the Socket.io
  // "event:{id}:dashboard" room.
  static async getEventCounts(eventId) {
    const { rows } = await pool.query(
      `SELECT er.registration_type,
              COUNT(DISTINCT al.registration_id) FILTER (WHERE al.action = 'check_in') AS currently_checked_in
       FROM event_registrations er
       LEFT JOIN LATERAL (
         SELECT action FROM attendance_logs
         WHERE registration_id = er.id
         ORDER BY scanned_at DESC LIMIT 1
       ) al ON true
       WHERE er.event_id = $1
       GROUP BY er.registration_type`,
      [eventId]
    );
    return rows;
  }
}

module.exports = AttendanceLog;