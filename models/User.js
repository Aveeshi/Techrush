const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

/*
  CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    roll_number TEXT,
    department TEXT,
    year INT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  This is the ONLY self-signup table. A student's role in any given
  event (attendee / volunteer / team head) is never stored here — it
  lives in event_registrations and team_heads. See design doc: role
  is contextual to an event, identity is not.
*/

// Committed to public/avatars/ — plain flat-color SVGs, no external
// dependency. One is assigned ONCE at signup time (see create()/
// createFromGoogle() below) whenever the student didn't upload their own
// photo, so it stays stable across sessions instead of being re-randomized
// on every page load.
const DEFAULT_AVATARS = [
  '/avatars/avatar-1.svg',
  '/avatars/avatar-2.svg',
  '/avatars/avatar-3.svg',
  '/avatars/avatar-4.svg',
  '/avatars/avatar-5.svg',
  '/avatars/avatar-6.svg',
];

function randomDefaultAvatar() {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
}

class User {
  static async create({ name, email, password, rollNumber, department, year, phone, profilePhotoUrl }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO students (name, email, password_hash, roll_number, department, year, phone, profile_photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email, roll_number, department, year, phone, profile_photo_url, created_at`,
      [name, email, passwordHash, rollNumber, department, year, phone, profilePhotoUrl || randomDefaultAvatar()]
    );
    return rows[0];
  }

  static async findByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM students WHERE email = $1`, [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, email, roll_number, department, year, phone, profile_photo_url, created_at
       FROM students WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // For Google OAuth signups. Only ever called from the choose-role commit
  // step (never directly from the strategy) — by this point the person has
  // already picked "student" and filled every required field themselves,
  // so this is a full, complete insert, not a partial one.
  static async createFromGoogle({ name, email, googleId, rollNumber, department, year, phone, profilePhotoUrl }) {
    const { rows } = await pool.query(
      `INSERT INTO students (name, email, google_id, roll_number, department, year, phone, profile_photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email, google_id, roll_number, department, year, phone, profile_photo_url, created_at`,
      [name, email, googleId, rollNumber, department, year, phone, profilePhotoUrl || randomDefaultAvatar()]
    );
    return rows[0];
  }

  // POST /account/photo — student's own upload, replacing whichever
  // default avatar (or previous upload) they had.
  static async updatePhoto(studentId, url) {
    const { rows } = await pool.query(
      `UPDATE students SET profile_photo_url = $2 WHERE id = $1
       RETURNING id, name, email, roll_number, department, year, phone, profile_photo_url, created_at`,
      [studentId, url]
    );
    return rows[0] || null;
  }

  // All events this student has touched, across both roles (attendee/volunteer) —
  // powers the "my events" tab on the student dashboard
  static async getEventHistory(studentId) {
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.start_time, er.registration_type, er.status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.student_id = $1
       ORDER BY e.start_time DESC`,
      [studentId]
    );
    return rows;
  }

  // Every team this student has opted into (tech, content, etc.) — used to
  // build the "which task lists / chat channels do I see" query
  static async getTeams(studentId) {
    const { rows } = await pool.query(
      `SELECT tm.team_id, t.name, t.event_id
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.student_id = $1`,
      [studentId]
    );
    return rows;
  }

  // The real credited hours total, from BOTH sources that can earn a
  // student hours:
  //   1. Verified task work: attendance='present' AND status='verified' only
  //      (self-reported 'completed' hours never appear here until an
  //      organizer/head verifies).
  //   2. Event attendance: registered as 'attendee' AND actually checked in
  //      (checked_in_at IS NOT NULL) for an event/sub-event the organizer
  //      put a credit_hours value on (see Event.js's schema note) — a flat
  //      award per event, not hours-worked math.
  static async getCreditedHours(studentId) {
    const { rows } = await pool.query(
      `SELECT
         COALESCE((
           SELECT SUM(ta.hours_logged) FROM task_assignments ta
           WHERE ta.student_id = $1 AND ta.attendance = 'present' AND ta.status = 'verified'
         ), 0)
         +
         COALESCE((
           SELECT SUM(COALESCE(e.credit_hours, se.credit_hours))
           FROM event_registrations er
           LEFT JOIN events e ON e.id = er.event_id
           LEFT JOIN sub_events se ON se.id = er.sub_event_id
           WHERE er.student_id = $1
             AND er.registration_type = 'attendee'
             AND er.checked_in_at IS NOT NULL
         ), 0)
         AS total_hours`,
      [studentId]
    );
    return Number(rows[0].total_hours);
  }

  // Same two sources as getCreditedHours, broken down per club. A team's
  // club comes from whichever of its container (event OR sub-event,
  // through the sub-event's own parent event) actually has one, hence the
  // COALESCE across both LEFT JOIN paths — same shape event attendance's
  // club resolution reuses below.
  static async getCreditedHoursByClub(studentId) {
    const { rows } = await pool.query(
      `SELECT club_id, club_name, SUM(hours) AS total_hours
       FROM (
         SELECT c.id AS club_id, c.name AS club_name, ta.hours_logged AS hours
         FROM task_assignments ta
         JOIN tasks t ON t.id = ta.task_id
         JOIN groups g ON g.id = t.group_id
         JOIN teams tm ON tm.id = g.team_id
         LEFT JOIN events e1 ON e1.id = tm.event_id
         LEFT JOIN sub_events se1 ON se1.id = tm.sub_event_id
         LEFT JOIN events e2 ON e2.id = se1.event_id
         JOIN clubs c ON c.id = COALESCE(e1.club_id, e2.club_id)
         WHERE ta.student_id = $1
           AND ta.attendance = 'present'
           AND ta.status = 'verified'

         UNION ALL

         SELECT c.id AS club_id, c.name AS club_name, COALESCE(e.credit_hours, se2.credit_hours) AS hours
         FROM event_registrations er
         LEFT JOIN events e ON e.id = er.event_id
         LEFT JOIN sub_events se2 ON se2.id = er.sub_event_id
         LEFT JOIN events pe ON pe.id = se2.event_id
         JOIN clubs c ON c.id = COALESCE(e.club_id, pe.club_id)
         WHERE er.student_id = $1
           AND er.registration_type = 'attendee'
           AND er.checked_in_at IS NOT NULL
           AND COALESCE(e.credit_hours, se2.credit_hours) IS NOT NULL
       ) combined
       GROUP BY club_id, club_name
       ORDER BY club_name`,
      [studentId]
    );
    return rows.map((r) => ({ ...r, total_hours: Number(r.total_hours) }));
  }

  // One row per credited task assignment AND per credited event
  // attendance — the "My Hours" table on the account page. `earned_at`
  // is verified_at for a task row, checked_in_at for an event row, so
  // both sort chronologically together. Ordered newest-first so a
  // just-verified task or just-checked-in event (pushed live over
  // 'hours:updated') belongs at the top, matching where the client
  // prepends it.
  static async getHoursBreakdown(studentId) {
    const { rows } = await pool.query(
      `SELECT ta.id, ta.hours_logged, ta.verified_at AS earned_at, t.title AS task_title,
              tm.name AS team_name, c.name AS club_name
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN groups g ON g.id = t.group_id
       JOIN teams tm ON tm.id = g.team_id
       LEFT JOIN events e1 ON e1.id = tm.event_id
       LEFT JOIN sub_events se1 ON se1.id = tm.sub_event_id
       LEFT JOIN events e2 ON e2.id = se1.event_id
       JOIN clubs c ON c.id = COALESCE(e1.club_id, e2.club_id)
       WHERE ta.student_id = $1
         AND ta.attendance = 'present'
         AND ta.status = 'verified'

       UNION ALL

       SELECT er.id, COALESCE(e.credit_hours, se2.credit_hours) AS hours_logged, er.checked_in_at AS earned_at,
              COALESCE(e.title, se2.title) AS task_title, 'Event attendance' AS team_name, c.name AS club_name
       FROM event_registrations er
       LEFT JOIN events e ON e.id = er.event_id
       LEFT JOIN sub_events se2 ON se2.id = er.sub_event_id
       LEFT JOIN events pe ON pe.id = se2.event_id
       JOIN clubs c ON c.id = COALESCE(e.club_id, pe.club_id)
       WHERE er.student_id = $1
         AND er.registration_type = 'attendee'
         AND er.checked_in_at IS NOT NULL
         AND COALESCE(e.credit_hours, se2.credit_hours) IS NOT NULL

       ORDER BY earned_at DESC`,
      [studentId]
    );
    return rows;
  }

  // Student self-edit on the account page — name + the profile fields
  // collected at signup (roll number/department/year/phone). Email is
  // deliberately NOT editable here (it's the login identity and the
  // roster-matching key in ClubRoster.findClubIdsForEmail — changing it
  // silently would desync club membership).
  static async updateProfile(studentId, { name, rollNumber, department, year, phone }) {
    const { rows } = await pool.query(
      `UPDATE students
       SET name = COALESCE($2, name),
           roll_number = COALESCE($3, roll_number),
           department = COALESCE($4, department),
           year = COALESCE($5, year),
           phone = COALESCE($6, phone)
       WHERE id = $1
       RETURNING id, name, email, roll_number, department, year, phone, created_at`,
      [studentId, name, rollNumber, department, year, phone]
    );
    return rows[0] || null;
  }

  // Set the student's primary/first priority club
  static async setPriorityClub(studentId, clubId) {
    const { rows } = await pool.query(
      `UPDATE students SET priority_club_id = $2 WHERE id = $1 RETURNING *`,
      [studentId, clubId]
    );
    return rows[0] || null;
  }

  // Get student's priority club (or fallback to the first club they joined)
  static async getPriorityClub(studentId) {
    const { rows } = await pool.query(
      `SELECT c.*, s.priority_club_id
       FROM students s
       LEFT JOIN clubs c ON c.id = COALESCE(
         s.priority_club_id,
         (SELECT cm.club_id FROM club_members cm WHERE cm.student_id = s.id ORDER BY cm.joined_at ASC LIMIT 1)
       )
       WHERE s.id = $1`,
      [studentId]
    );
    return rows[0] || null;
  }

  // Returns all attended events with non-editable verified log data (name, date, hours, club)
  static async getAttendedEventsWithDetails(studentId) {
    const { rows } = await pool.query(
      `SELECT er.id AS registration_id, er.registration_type, er.checked_in_at, er.status,
              COALESCE(e.id, se.id) AS event_id,
              COALESCE(e.title, se.title) AS title,
              COALESCE(e.description, se.description) AS description,
              COALESCE(e.start_time, se.start_time) AS event_date,
              COALESCE(e.venue, se.venue) AS venue,
              COALESCE(e.credit_hours, se.credit_hours, 0) AS credit_hours,
              c.id AS club_id, c.name AS club_name, c.logo_url AS club_logo
       FROM event_registrations er
       LEFT JOIN events e ON e.id = er.event_id
       LEFT JOIN sub_events se ON se.id = er.sub_event_id
       LEFT JOIN events pe ON pe.id = se.event_id
       JOIN clubs c ON c.id = COALESCE(e.club_id, pe.club_id)
       WHERE er.student_id = $1
         AND er.checked_in_at IS NOT NULL
       ORDER BY event_date DESC`,
      [studentId]
    );
    return rows;
  }

  // Calculate hours specifically for the student's priority club
  static async getPriorityClubHours(studentId, priorityClubId) {
    if (!priorityClubId) return 0;
    const { rows } = await pool.query(
      `SELECT
         COALESCE((
           SELECT SUM(ta.hours_logged)
           FROM task_assignments ta
           JOIN tasks t ON t.id = ta.task_id
           JOIN groups g ON g.id = t.group_id
           JOIN teams tm ON tm.id = g.team_id
           LEFT JOIN events e1 ON e1.id = tm.event_id
           LEFT JOIN sub_events se1 ON se1.id = tm.sub_event_id
           LEFT JOIN events e2 ON e2.id = se1.event_id
           WHERE ta.student_id = $1
             AND ta.attendance = 'present'
             AND ta.status = 'verified'
             AND COALESCE(e1.club_id, e2.club_id) = $2
         ), 0)
         +
         COALESCE((
           SELECT SUM(COALESCE(e.credit_hours, se2.credit_hours))
           FROM event_registrations er
           LEFT JOIN events e ON e.id = er.event_id
           LEFT JOIN sub_events se2 ON se2.id = er.sub_event_id
           LEFT JOIN events pe ON pe.id = se2.event_id
           WHERE er.student_id = $1
             AND er.registration_type = 'attendee'
             AND er.checked_in_at IS NOT NULL
             AND COALESCE(e.club_id, pe.club_id) = $2
         ), 0)
         AS priority_hours`,
      [studentId, priorityClubId]
    );
    return Number(rows[0]?.priority_hours || 0);
  }
}

module.exports = User;