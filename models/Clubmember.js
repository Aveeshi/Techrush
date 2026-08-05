const pool = require('../utils/db');

/*
  CREATE TABLE club_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, student_id)
  );

  A student can belong to many clubs; a club has many members. This is
  independent of event_registrations — being a club member says nothing
  about which events you've registered for, and vice versa. The one place
  they intersect: whether a student is even OFFERED the volunteer option
  on a given event depends on club membership (see canVolunteerForEvent
  below). Non-members only ever see the attendee/register option.
*/

class ClubMember {
  static async join(clubId, studentId) {
    const { rows } = await pool.query(
      `INSERT INTO club_members (club_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (club_id, student_id) DO NOTHING
       RETURNING *`,
      [clubId, studentId]
    );
    return rows[0] || null;
  }

  static async leave(clubId, studentId) {
    await pool.query(
      `DELETE FROM club_members WHERE club_id = $1 AND student_id = $2`,
      [clubId, studentId]
    );
  }

  static async isMember(clubId, studentId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM club_members WHERE club_id = $1 AND student_id = $2`,
      [clubId, studentId]
    );
    return rows.length > 0;
  }

  // Every club a student belongs to — powers "my clubs" on their dashboard
  static async listClubsForStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.description, c.logo_url, cm.joined_at
       FROM club_members cm
       JOIN clubs c ON c.id = cm.club_id
       WHERE cm.student_id = $1
       ORDER BY c.name`,
      [studentId]
    );
    return rows;
  }

  // Full member roster — for the club's own management view
  static async listMembers(clubId) {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.email, cm.joined_at
       FROM club_members cm
       JOIN students s ON s.id = cm.student_id
       WHERE cm.club_id = $1
       ORDER BY s.name`,
      [clubId]
    );
    return rows;
  }

  // THE gate for the attendee-vs-volunteer choice on an event. Call this
  // when rendering an event to a student, and enforce it again server-side
  // inside EventRegistration.create() — never trust the frontend's button
  // state as the actual authorization check.
  static async canVolunteerForEvent(studentId, eventId) {
    const { rows } = await pool.query(
      `SELECT 1
       FROM events e
       JOIN club_members cm ON cm.club_id = e.club_id
       WHERE e.id = $1 AND cm.student_id = $2`,
      [eventId, studentId]
    );
    return rows.length > 0;
  }
}

module.exports = ClubMember;