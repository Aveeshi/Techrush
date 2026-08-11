const pool = require('../utils/db');

/*
  CREATE TABLE logbook_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) NOT NULL,
    club_id UUID REFERENCES clubs(id) NOT NULL,
    url TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Photos a student attaches to their own logbook for one specific club —
  uploaded straight to Cloudinary (see utils/cloudinary.js's makeUploader),
  this table only ever stores the resulting secure_url, same pattern as
  EventImage/User.profile_photo_url. Scoped to (student_id, club_id), not
  just student_id, since the same student may generate logbooks for more
  than one club and their photo sets shouldn't bleed into each other.
*/

class LogbookImage {
  static async create({ studentId, clubId, url }) {
    const { rows } = await pool.query(
      `INSERT INTO logbook_images (student_id, club_id, url, sort_order)
       VALUES ($1, $2, $3, (
         SELECT COALESCE(MAX(sort_order), -1) + 1 FROM logbook_images WHERE student_id = $1 AND club_id = $2
       ))
       RETURNING *`,
      [studentId, clubId, url]
    );
    return rows[0];
  }

  static async findByStudentAndClub(studentId, clubId) {
    const { rows } = await pool.query(
      `SELECT * FROM logbook_images WHERE student_id = $1 AND club_id = $2 ORDER BY sort_order ASC, created_at ASC`,
      [studentId, clubId]
    );
    return rows;
  }

  // Deletion is scoped to studentId too, not just the row id — a student
  // can only ever remove their own uploads, never guess another student's
  // image id off the URL and delete it.
  static async deleteForStudent(id, studentId) {
    const { rows } = await pool.query(
      `DELETE FROM logbook_images WHERE id = $1 AND student_id = $2 RETURNING *`,
      [id, studentId]
    );
    return rows[0] || null;
  }
}

module.exports = LogbookImage;
