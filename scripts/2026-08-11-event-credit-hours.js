// One-off migration: lets an organizer put a CCA credit-hours value on an
// event/sub-event at creation time — exactly like a task's assigned_hours
// — so a student who registers as an attendee AND actually checks in gets
// that many hours counted toward their total (see User.getCreditedHours*
// and getHoursBreakdown). NULL means "no credit configured" (the pre-existing
// behavior — attending an event earns nothing unless an organizer opts in).
// Safe to re-run — IF NOT EXISTS guards every statement.
require('dotenv').config();
const pool = require('../utils/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS credit_hours NUMERIC(4,1)
    `);
    await client.query(`
      ALTER TABLE sub_events ADD COLUMN IF NOT EXISTS credit_hours NUMERIC(4,1)
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
