// One-off migration: make event_registrations polymorphic over events/sub_events,
// mirroring the teams / event_heads (event_id XOR sub_event_id) pattern.
// Safe to re-run — every statement is guarded (IF NOT EXISTS / IF EXISTS / DO block).
require('dotenv').config();
const pool = require('../utils/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE event_registrations
        ADD COLUMN IF NOT EXISTS sub_event_id UUID REFERENCES sub_events(id)
    `);

    await client.query(`
      ALTER TABLE event_registrations
        ALTER COLUMN event_id DROP NOT NULL
    `);

    // Drop whatever the old UNIQUE(event_id, student_id) constraint is named,
    // found dynamically instead of assuming Postgres's default naming.
    const { rows: uniqueConstraints } = await client.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'event_registrations'
        AND tc.constraint_type = 'UNIQUE'
        AND ccu.column_name = 'event_id'
    `);
    for (const { constraint_name } of uniqueConstraints) {
      await client.query(`ALTER TABLE event_registrations DROP CONSTRAINT "${constraint_name}"`);
      console.log(`Dropped old constraint ${constraint_name}`);
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'event_registrations_container_check'
        ) THEN
          ALTER TABLE event_registrations
            ADD CONSTRAINT event_registrations_container_check
            CHECK ((event_id IS NOT NULL) <> (sub_event_id IS NOT NULL));
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_unique
        ON event_registrations(event_id, student_id) WHERE event_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_subevent_unique
        ON event_registrations(sub_event_id, student_id) WHERE sub_event_id IS NOT NULL
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
