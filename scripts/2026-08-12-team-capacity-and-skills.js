// One-off migration: team capacity + required skills.
//   - teams.max_size — optional cap set by whoever creates the team; NULL
//     means unlimited (every team created before this migration keeps
//     behaving exactly as before). Team.addMember() enforces it at the DB
//     level, not just in the UI.
//   - team_required_skills — same shape/vocabulary as event_required_skills
//     and task_skill_tags (see models/Skilltag.js) — literally the same
//     skill_tags rows shown at student signup, so "skills required" on a
//     team and "skills you'd volunteer with" on a student are directly
//     comparable, not two separate lists.
// Safe to re-run — every statement is guarded (IF NOT EXISTS).
require('dotenv').config();
const pool = require('../utils/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS max_size INT
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_required_skills (
        team_id UUID REFERENCES teams(id) NOT NULL,
        skill_tag_id UUID REFERENCES skill_tags(id) NOT NULL,
        PRIMARY KEY (team_id, skill_tag_id)
      )
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
