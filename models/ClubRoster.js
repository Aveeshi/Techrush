const pool = require('../utils/db');

/*
  CREATE TABLE club_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) NOT NULL,
    name TEXT,
    email TEXT NOT NULL,
    uploaded_by UUID REFERENCES organizers(id),
    uploaded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, email)
  );

  This is the actual verification mechanism club_members was missing:
  an organizer uploads their club's member list (name + email, parsed
  from an .xlsx — see controllers/organizerController.js), and THIS
  table is the source of truth for "is this person really in the club,"
  not anything a student can self-declare at signup.

  Every row here is checked against at student signup time
  (findClubIdsForEmail) to auto-populate club_members — students no
  longer pick clubs themselves at all (see authController.js).

  replaceForClub() does a full replace, not a merge: every re-upload
  wipes and reinserts that club's rows. It's still additive from the
  club_members side, though — reconcileClubMembers() (called right after
  a replace) only ever ADDS memberships for matching existing accounts,
  never removes one for someone who fell off a re-uploaded roster. That's
  a deliberate choice: losing club access because of a spreadsheet edit
  would be a surprising, hard-to-debug way to get locked out.
*/

class ClubRoster {
  static async replaceForClub(clubId, members, uploadedBy) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM club_rosters WHERE club_id = $1`, [clubId]);

      if (members.length) {
        const values = [];
        const params = [];
        members.forEach((m, i) => {
          const base = i * 4;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
          params.push(clubId, m.name || null, m.email.toLowerCase(), uploadedBy);
        });
        // ON CONFLICT guards against the same email appearing twice in one
        // sheet (common with duplicate rows in real-world exports).
        await client.query(
          `INSERT INTO club_rosters (club_id, name, email, uploaded_by)
           VALUES ${values.join(', ')}
           ON CONFLICT (club_id, email) DO UPDATE SET name = EXCLUDED.name`,
          params
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findByClub(clubId) {
    const { rows } = await pool.query(
      `SELECT * FROM club_rosters WHERE club_id = $1 ORDER BY name`,
      [clubId]
    );
    return rows;
  }

  // The signup-time lookup: every club this email is rostered for.
  static async findClubIdsForEmail(email) {
    const { rows } = await pool.query(
      `SELECT club_id FROM club_rosters WHERE email = $1`,
      [email.toLowerCase()]
    );
    return rows.map((r) => r.club_id);
  }

  // Called right after a roster replace — joins any ALREADY-existing
  // student account whose email matches the new roster straight into
  // club_members, so someone who signed up before their name was on the
  // sheet doesn't have to do anything to get access.
  static async reconcileClubMembers(clubId) {
    const { rows } = await pool.query(
      `INSERT INTO club_members (club_id, student_id)
       SELECT $1, s.id
       FROM club_rosters cr
       JOIN students s ON LOWER(s.email) = cr.email
       WHERE cr.club_id = $1
       ON CONFLICT (club_id, student_id) DO NOTHING
       RETURNING student_id`,
      [clubId]
    );
    return rows.length;
  }
}

module.exports = ClubRoster;
