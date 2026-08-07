const bcrypt = require('bcryptjs');
const pool = require('../utils/db');

/*
  CREATE TABLE organizers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT CHECK (role IN ('president','vice_president')),
    created_at TIMESTAMPTZ DEFAULT now()
  );
  UNIQUE INDEX organizers_club_role_unique ON organizers(club_id, role);

  Why this exists separately from Club: the club is the entity events
  belong to, but a club can't itself hold a login. Organizer is the
  real account a person logs in with — an office-bearer acting on
  behalf of their club_id. This is what event.organizer_id and
  task_assignments.verified_by actually point to.

  role + the (club_id, role) unique index are the entire enforcement of
  "only a President and a Vice President can hold an organizer account
  for a club" — a club can have at most one of each, never a duplicate
  role, purely from the DB constraint (not just app-level checking).
  findOpenSlots() below is what signup uses to know which club/role
  combinations are still available to offer.
*/

class Organizer {
  static async create({ name, email, password, clubId, role }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO organizers (name, email, password_hash, club_id, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, club_id, role, created_at`,
      [name, email, passwordHash, clubId, role]
    );
    return rows[0];
  }

  // Includes password_hash — used only internally by the login route,
  // never returned to the client directly.
  static async findByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM organizers WHERE email = $1`, [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, email, club_id, role, created_at FROM organizers WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // For Google OAuth signups, committed from the choose-role step after the
  // person has selected the organizer tab and picked/created their club.
  static async createFromGoogle({ name, email, googleId, clubId, role }) {
    const { rows } = await pool.query(
      `INSERT INTO organizers (name, email, google_id, club_id, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, club_id, role, created_at`,
      [name, email, googleId, clubId, role]
    );
    return rows[0];
  }

  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  // Lets a President/VP edit their own name/email (the organizer Account
  // tab) — password change is intentionally out of scope here, same as
  // the student account page not offering one either.
  static async update(id, { name, email }) {
    const { rows } = await pool.query(
      `UPDATE organizers
       SET name = COALESCE($2, name), email = COALESCE($3, email)
       WHERE id = $1
       RETURNING id, name, email, club_id, role, created_at`,
      [id, name, email]
    );
    return rows[0] || null;
  }

  // All events this organizer has created, regardless of current status
  static async getEvents(organizerId) {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE organizer_id = $1 ORDER BY start_time DESC`,
      [organizerId]
    );
    return rows;
  }

  // Which (club, role) combinations are still available to sign up for —
  // the entire "President + VP only" gate on the signup form. A club with
  // both roles already taken is simply absent from the result, and a club
  // with one role taken only offers the other. Re-checked server-side at
  // actual signup time (see authController) — never trust this list alone.
  static async findOpenSlots() {
    const { rows } = await pool.query(
      `SELECT c.id AS club_id, c.name AS club_name,
              bool_or(o.role = 'president') AS president_taken,
              bool_or(o.role = 'vice_president') AS vice_president_taken
       FROM clubs c
       LEFT JOIN organizers o ON o.club_id = c.id
       GROUP BY c.id, c.name
       ORDER BY c.name`
    );
    return rows
      .map((r) => ({
        clubId: r.club_id,
        clubName: r.club_name,
        openRoles: [
          !r.president_taken && 'president',
          !r.vice_president_taken && 'vice_president',
        ].filter(Boolean),
      }))
      .filter((c) => c.openRoles.length > 0);
  }

  // The actual server-side re-check at signup time — never trust that the
  // dropdown's options were still accurate by the time the form posted.
  static async isRoleOpen(clubId, role) {
    const { rows } = await pool.query(
      `SELECT 1 FROM organizers WHERE club_id = $1 AND role = $2`,
      [clubId, role]
    );
    return rows.length === 0;
  }
}

module.exports = Organizer;