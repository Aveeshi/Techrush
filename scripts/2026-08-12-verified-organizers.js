// One-off migration: verified_organizers allowlist table — the "only the
// real President/VP can sign up as an organizer" gate. Safe to re-run
// (CREATE TABLE IF NOT EXISTS).
//
// To pre-populate it, add rows to the SEED array below with each club's
// exact name (must already exist in `clubs`) and its office-bearers, then
// run this script again — bulkAdd() upserts on (club_id, email), so
// re-running after editing SEED is how you add/update entries later too.
require('dotenv').config();
const pool = require('../utils/db');
const Club = require('../models/Club');
const VerifiedOrganizer = require('../models/VerifiedOrganizer');

// Fill this in with the real club presidents/VPs before running, e.g.:
// { clubName: 'Robotics Club', name: 'Jane Doe', email: 'jane@example.com', role: 'president' },
const SEED = [
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS verified_organizers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT CHECK (role IN ('president','vice_president')) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(club_id, email)
      )
    `);

    await client.query('COMMIT');
    console.log('Table verified_organizers ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exitCode = 1;
    return;
  } finally {
    client.release();
  }

  if (SEED.length) {
    const entries = [];
    for (const s of SEED) {
      const club = await Club.findByName(s.clubName);
      if (!club) {
        console.warn(`Skipping "${s.name}" <${s.email}> — no club named "${s.clubName}" found`);
        continue;
      }
      entries.push({ clubId: club.id, name: s.name, email: s.email, role: s.role });
    }
    const inserted = await VerifiedOrganizer.bulkAdd(entries);
    console.log(`Upserted ${inserted.length} verified organizer(s).`);
  } else {
    console.log('SEED is empty — edit scripts/2026-08-12-verified-organizers.js and re-run to populate.');
  }

  await pool.end();
}

main();
