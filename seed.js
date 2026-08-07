/*
  Seeds the three lookup tables the signup form's pickers depend on:
  clubs, event_types, skill_tags. Safe to run more than once — every
  underlying model method uses ON CONFLICT (name) DO NOTHING, so re-running
  this just skips whatever already exists instead of erroring or duplicating.

  Run with:  node seed.js
  (or add "seed": "node seed.js" to package.json scripts and run `npm run seed`)
*/

const pool = require('./utils/db');
const Club = require('./models/Club');
const EventType = require('./models/Eventtype');
const SkillTag = require('./models/Skilltag');

const CLUBS = [
  { name: 'Robotics Club', description: 'Builds and competes with robots' },
  { name: 'Coding Club', description: 'Programming, hackathons, and dev workshops' },
  { name: 'Photography Club', description: 'Event coverage, reels, and photo walks' },
  { name: 'Cultural Club', description: 'Fests, performances, and cultural events' },
  { name: 'Entrepreneurship Cell', description: 'Startup talks, pitch events, mentorship' },
];

const EVENT_TYPES = [
  'Hackathon',
  'Game Competition',
  'Mock Interview',
  'Meetup',
  'Workshop',
  'Cultural Fest',
  'Guest Talk',
  'Sports Tournament',
];

const SKILL_TAGS = [
  'Python',
  'Web Dev',
  'Reel Making',
  'Graphic Design',
  'Public Speaking',
  'Video Editing',
  'Social Media Management',
  'Photography',
  'Event Logistics',
  'Content Writing',
  'UI/UX Design',
  'Data Analysis',
];

async function seed() {
  console.log('Seeding clubs...');
  for (const club of CLUBS) {
    const result = await Club.create({ name: club.name, description: club.description, logoUrl: null });
    console.log(result ? `  + ${club.name}` : `  = ${club.name} (already exists)`);
  }

  console.log('Seeding event types...');
  for (const name of EVENT_TYPES) {
    const result = await EventType.create(name);
    console.log(result ? `  + ${name}` : `  = ${name} (already exists)`);
  }

  console.log('Seeding skill tags...');
  for (const name of SKILL_TAGS) {
    const result = await SkillTag.create(name);
    console.log(result ? `  + ${name}` : `  = ${name} (already exists)`);
  }

  console.log('Done.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
