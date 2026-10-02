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

    // Club members list with individual contribution metrics (events attended and hours earned in this club)
    const membersRes = await pool.query(
      `SELECT s.id, s.name, s.email, s.roll_number, s.department, s.year, cm.joined_at,
              COUNT(DISTINCT er.id) FILTER (WHERE er.checked_in_at IS NOT NULL) AS events_attended,
              COALESCE(SUM(e.credit_hours) FILTER (WHERE er.checked_in_at IS NOT NULL), 0) AS hours_earned,
              sc.role_title AS coordinator_role,
              CASE WHEN sc.id IS NOT NULL THEN true ELSE false END AS is_coordinator
       FROM club_members cm
       JOIN students s ON s.id = cm.student_id
       LEFT JOIN event_registrations er ON er.student_id = s.id
       LEFT JOIN events e ON e.id = er.event_id AND e.club_id = $1
       LEFT JOIN student_coordinators sc ON sc.student_id = s.id AND sc.club_id = $1
       WHERE cm.club_id = $1
       GROUP BY s.id, s.name, s.email, s.roll_number, s.department, s.year, cm.joined_at, sc.role_title, sc.id
       ORDER BY hours_earned DESC, s.name ASC`,
      [clubId]
    );
    club.members = membersRes.rows;

    return club;
  }

  // Get deep-dive contribution dossier of a specific student in a specific club
  static async getMemberClubContributions(clubId, studentId) {
    const clubRes = await pool.query(`SELECT * FROM clubs WHERE id = $1`, [clubId]);
    if (!clubRes.rows[0]) return null;
    const club = clubRes.rows[0];

    const studentRes = await pool.query(
      `SELECT s.*, cm.joined_at AS club_joined_at,
              sc.role_title AS coordinator_role,
              sc.can_inspect_records
       FROM students s
       LEFT JOIN club_members cm ON cm.student_id = s.id AND cm.club_id = $1
       LEFT JOIN student_coordinators sc ON sc.student_id = s.id AND sc.club_id = $1
       WHERE s.id = $2`,
      [clubId, studentId]
    );
    if (!studentRes.rows[0]) return null;
    const student = studentRes.rows[0];

    // All events attended by this student in this club
    const eventsRes = await pool.query(
      `SELECT e.id, e.title, e.start_time, e.end_time, e.venue,
              COALESCE(e.credit_hours, 0) AS credit_hours,
              er.checked_in_at, er.status, er.registration_type
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.student_id = $1
         AND e.club_id = $2
         AND er.checked_in_at IS NOT NULL
       ORDER BY e.start_time DESC`,
      [studentId, clubId]
    );
    const attendedEvents = eventsRes.rows;

    // Volunteer team memberships in this club
    const teamsRes = await pool.query(
      `SELECT t.name AS team_name, e.title AS event_title,
              CASE WHEN th.id IS NOT NULL THEN 'Team Head' ELSE 'Volunteer' END AS role,
              tm.joined_at
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       LEFT JOIN team_heads th ON th.team_id = t.id AND th.student_id = tm.student_id
       LEFT JOIN events e ON e.id = t.event_id
       WHERE tm.student_id = $1
         AND (e.club_id = $2 OR e.club_id IS NULL)
       ORDER BY tm.joined_at DESC`,
      [studentId, clubId]
    );
    const volunteerTeams = teamsRes.rows;

    // Semester report submissions in this club
    const reportsRes = await pool.query(
      `SELECT sr.*, fc.name AS faculty_name
       FROM semester_reports sr
       LEFT JOIN faculty_coordinators fc ON fc.id = sr.verified_by
       WHERE sr.student_id = $1
         AND sr.club_id = $2
       ORDER BY sr.academic_year DESC, sr.semester DESC`,
      [studentId, clubId]
    );
    const semesterReports = reportsRes.rows;

    const totalHours = attendedEvents.reduce((sum, ev) => sum + parseFloat(ev.credit_hours || 0), 0);

    return {
      club,
      student,
      attendedEvents,
      volunteerTeams,
      semesterReports,
      totalHours,
    };
  }

  // Get simple list of all clubs
  static async getAllClubs() {
    const { rows } = await pool.query(`SELECT id, name, logo_url FROM clubs ORDER BY name ASC`);
    return rows;
  }
}

module.exports = InstitutionalCoordinator;
