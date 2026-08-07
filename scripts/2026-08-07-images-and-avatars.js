// One-off migration: event_images table (multi-image galleries with a
// primary/thumbnail) + students.profile_photo_url. Safe to re-run — every
// statement is guarded (IF NOT EXISTS / DO block).
require('dotenv').config();
const pool = require('../utils/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES events(id) NOT NULL,
        url TEXT NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // At most one primary image per event — enforced by the DB, not just
    // application code (EventImage.setPrimary still unsets the old one
    // transactionally, but this is the actual guarantee).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS event_images_one_primary_per_event
        ON event_images(event_id) WHERE is_primary
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS event_images_event_id_idx ON event_images(event_id)
    `);

    await client.query(`
      ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_photo_url TEXT
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
