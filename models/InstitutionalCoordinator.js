const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

class InstitutionalCoordinator {
  static async findByEmail(email) {
    const { rows } = await pool.query(
      `SELECT * FROM institutional_coordinators WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT * FROM institutional_coordinators WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // Returns all clubs with summary metrics: FC name, total events, total members, student coordinator count
  static async getAllClubsOverview() {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.description, c.logo_url, c.created_at,
              fc.id AS faculty_id, fc.name AS faculty_name, fc.email AS faculty_email,
              fc.department AS faculty_department,
              COUNT(DISTINCT e.id) AS total_events,
              COUNT(DISTINCT cm.student_id) AS total_members,
              COUNT(DISTINCT sc.student_id) AS student_coordinators_count
       FROM clubs c
       LEFT JOIN faculty_coordinators fc ON fc.club_id = c.id
       LEFT JOIN events e ON e.club_id = c.id
       LEFT JOIN club_members cm ON cm.club_id = c.id
       LEFT JOIN student_coordinators sc ON sc.club_id = c.id
       GROUP BY c.id, c.name, c.description, c.logo_url, c.created_at,
                fc.id, fc.name, fc.email, fc.department
       ORDER BY c.name ASC`
    );
    return rows;
  }

  // Complete deep-dive into one club: FC, student coordinators, all events + attendee counts
  static async getClubCompleteDetails(clubId) {
    const clubRes = await pool.query(
      `SELECT c.*,
              fc.id AS faculty_id, fc.name AS faculty_name, fc.email AS faculty_email,
              fc.department AS faculty_department, fc.designation AS faculty_designation,
              fc.phone AS faculty_phone
       FROM clubs c
       LEFT JOIN faculty_coordinators fc ON fc.club_id = c.id
       WHERE c.id = $1`,
      [clubId]
    );
    if (!clubRes.rows[0]) return null;

    const club = clubRes.rows[0];

    // Student coordinators for this club
    const scRes = await pool.query(
      `SELECT sc.*, s.name AS student_name, s.email AS student_email, s.roll_number,
              s.department, s.year, s.phone
       FROM student_coordinators sc
       JOIN students s ON s.id = sc.student_id
       WHERE sc.club_id = $1
       ORDER BY sc.created_at DESC`,
      [clubId]
    );
    club.student_coordinators = scRes.rows;

    // All events conducted by this club
    const eventsRes = await pool.query(
      `SELECT e.*,
              et.name AS event_type_name,
              o.name AS organizer_name,
              COUNT(DISTINCT er.id) AS total_registrations,
              COUNT(DISTINCT er.id) FILTER (WHERE er.checked_in_at IS NOT NULL) AS checked_in_count
       FROM events e
       LEFT JOIN event_types et ON et.id = e.event_type_id
       LEFT JOIN organizers o ON o.id = e.organizer_id
       LEFT JOIN event_registrations er ON er.event_id = e.id
       WHERE e.club_id = $1
       GROUP BY e.id, et.name, o.name
       ORDER BY e.start_time DESC`,
      [clubId]
    );
    club.events = eventsRes.rows;

    // Club members list
    const membersRes = await pool.query(
      `SELECT s.id, s.name, s.email, s.roll_number, s.department, s.year, cm.joined_at
       FROM club_members cm
       JOIN students s ON s.id = cm.student_id
       WHERE cm.club_id = $1
       ORDER BY s.name ASC`,
      [clubId]
    );
    club.members = membersRes.rows;

    return club;
  }
}

module.exports = InstitutionalCoordinator;
