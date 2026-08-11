// One-off migration: CCA Activity Logbook feature.
//   - clubs.logbook_enabled — organizer-side toggle; students only see the
//     "generate logbook" option for clubs where this is true.
//   - logbook_images — photos a student uploads (Cloudinary URLs, never
//     local files) to be embedded at the end of their generated logbook.
// Safe to re-run — every statement is guarded (IF NOT EXISTS / DO block).
require('dotenv').config();
const pool = require('../utils/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logbook_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS logbook_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES students(id) NOT NULL,
        club_id UUID REFERENCES clubs(id) NOT NULL,
        url TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS logbook_images_student_club_idx
        ON logbook_images(student_id, club_id)
    `);

    await client.query('COMMIT');
    console.log('Migration applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
