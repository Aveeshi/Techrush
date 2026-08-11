/*
  One-off: wipes every student and organizer (all of them were demo data)
  and everything that references them.

  Postgres TRUNCATE ... CASCADE walks the FK graph automatically, so this
  also clears event_registrations, team_members, team_heads, tasks,
  task_assignments, chats, etc. — anything hanging off students/organizers,
  transitively through events/teams/sub_events. clubs, event_types, and
  skill_tags are NOT referenced by students/organizers so they survive
  untouched.

  Run once: node scripts/2026-08-08-wipe-demo-users.js
*/
const db = require('../utils/db');

async function main() {
  const { rows: before } = await db.query(`
    SELECT
      (SELECT count(*) FROM students)  AS students,
      (SELECT count(*) FROM organizers) AS organizers
  `);
  console.log('Before:', before[0]);

  await db.query('TRUNCATE TABLE students, organizers RESTART IDENTITY CASCADE');

  const { rows: after } = await db.query(`
    SELECT
      (SELECT count(*) FROM students)  AS students,
      (SELECT count(*) FROM organizers) AS organizers
  `);
  console.log('After:', after[0]);
  console.log('Done — students and organizers (and all dependent rows) wiped.');

  await db.end();
}

main().catch((err) => {
  console.error('Wipe failed:', err.message);
  process.exit(1);
});
