const pool = require('../utils/db');

/*
  CREATE TABLE verified_organizers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT CHECK (role IN ('president','vice_president')) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, email)
  );

  This is the actual gate on "who is allowed to even become an
  organizer" — a pre-populated allowlist of each club's real
  President/VP (name + email), entered by hand (see
  scripts/2026-08-12-verified-organizers.js), NOT anything a signing-up
  visitor gets to declare about themselves. Organizer.findOpenSlots()
  still governs which (club, role) SLOTS are unclaimed; this table
  governs whether the specific person claiming one is even eligible to.

  Checked at every organizer-account-creation path — plain signup AND
  the Google choose-role flow (see authController._organizerSignup /
  chooseRoleOrganizer) — matched on (club_id, email, role) so a club's
  President can't accidentally/deliberately claim the VP slot using
  their allowlisted President entry, or vice versa.
*/

class VerifiedOrganizer {
  static async isVerified(clubId, email, role) {
    const { rows } = await pool.query(
      `SELECT 1 FROM verified_organizers WHERE club_id = $1 AND email = $2 AND role = $3`,
      [clubId, email.toLowerCase(), role]
    );
    return rows.length > 0;
  }

  // Used to pre-fill a signed-up email's name onto the form isn't needed
  // today, but findByClub is handy for an eventual "who's still unclaimed"
  // admin view.
  static async findByClub(clubId) {
    const { rows } = await pool.query(
      `SELECT * FROM verified_organizers WHERE club_id = $1 ORDER BY role, name`,
      [clubId]
    );
    return rows;
  }

  // Bulk pre-population — the actual "add all the club presidents/VPs"
  // step, run once (and again whenever the roster of office-bearers
  // changes) via scripts/2026-08-12-verified-organizers.js, never from
  // user-facing request handlers.
  static async bulkAdd(entries) {
    if (!entries.length) return [];
    const values = [];
    const params = [];
    entries.forEach((e, i) => {
      const base = i * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(e.clubId, e.name, e.email.toLowerCase(), e.role);
    });
    const { rows } = await pool.query(
      `INSERT INTO verified_organizers (club_id, name, email, role)
       VALUES ${values.join(', ')}
       ON CONFLICT (club_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING *`,
      params
    );
    return rows;
  }
}

module.exports = VerifiedOrganizer;
