/*
  Seeds demo organizers (for clubs that don't have one yet) and demo
  events across every club, using the real club/event_type rows already
  in the DB rather than hardcoded IDs.

  Idempotent:
   - Organizers: looked up by email first, created only if missing.
   - Events: looked up by (club_id, title) first, created only if missing.
  Safe to run more than once — re-running just skips what already exists.

  Run with:  node seedEvents.js
*/

const pool = require('./utils/db');
const Club = require('./models/Club');
const Organizer = require('./models/Organizer');
const EventType = require('./models/Eventtype');
const Event = require('./models/Event');

// One demo organizer per club that doesn't already have one.
// Coding Club already has a real organizer (Aveeshi Kaushik) and is left alone.
const DEMO_ORGANIZERS = {
  'Robotics Club': { name: 'Rohan Mehta', email: 'robotics.demo@techrush.dev' },
  'Photography Club': { name: 'Ishita Verma', email: 'photography.demo@techrush.dev' },
  'Cultural Club': { name: 'Aditya Rao', email: 'cultural.demo@techrush.dev' },
  'Entrepreneurship Cell': { name: 'Neha Sharma', email: 'ecell.demo@techrush.dev' },
};
const DEMO_PASSWORD = 'Demo@1234'; // dev/demo only — not a real login path

// Demo events per club. Dates are relative to "today" (set below) so the
// seed stays sensible whenever it's run: a mix of past/completed and
// upcoming/published/draft to show off the schema's status + visibility fields.
function buildEventPlan(today) {
  const days = (n) => new Date(today.getTime() + n * 24 * 60 * 60 * 1000);

  return {
    'Coding Club': [
      {
        title: 'TechRush Hackathon 2026',
        type: 'Hackathon',
        description: '24-hour build sprint open to all branches — form teams of up to 4 and ship something real.',
        venue: 'Main Auditorium',
        start: days(21), end: days(22),
        status: 'published', visibility: 'public',
        registrationDeadline: days(18),
      },
      {
        title: 'Git & GitHub Workshop',
        type: 'Workshop',
        description: 'Hands-on session on branching, PRs, and resolving merge conflicts without crying.',
        venue: 'CS Lab 2',
        start: days(7), end: days(7),
        status: 'published', visibility: 'public',
        registrationDeadline: days(6),
      },
      {
        title: 'Mock Technical Interview Marathon',
        type: 'Mock Interview',
        description: 'Peer-run DSA + system design mock interviews with feedback sheets.',
        venue: 'Seminar Hall B',
        start: days(-14), end: days(-14),
        status: 'completed', visibility: 'club_only',
        registrationDeadline: days(-16),
      },
    ],
    'Robotics Club': [
      {
        title: 'Line Follower Bot Challenge',
        type: 'Game Competition',
        description: 'Build and race a line-following bot through an obstacle track. Kits provided.',
        venue: 'Robotics Lab',
        start: days(12), end: days(12),
        status: 'published', visibility: 'public',
        registrationDeadline: days(10),
      },
      {
        title: 'Intro to Arduino Workshop',
        type: 'Workshop',
        description: 'From blinking an LED to reading a sensor — a first-timer friendly Arduino primer.',
        venue: 'Robotics Lab',
        start: days(5), end: days(5),
        status: 'published', visibility: 'public',
        registrationDeadline: days(4),
      },
      {
        title: 'RoboWars Qualifiers',
        type: 'Sports Tournament',
        description: 'Combat-bot qualifiers to pick the team for the inter-college RoboWars finals.',
        venue: 'Open Grounds',
        start: days(-10), end: days(-10),
        status: 'completed', visibility: 'public',
        registrationDeadline: days(-12),
      },
    ],
    'Photography Club': [
      {
        title: 'Campus Photo Walk',
        type: 'Meetup',
        description: 'Golden-hour walk around campus — bring any camera, phones welcome.',
        venue: 'Campus Grounds (assemble at Gate 2)',
        start: days(4), end: days(4),
        status: 'published', visibility: 'public',
        registrationDeadline: days(3),
      },
      {
        title: 'Reels & Storytelling Workshop',
        type: 'Workshop',
        description: 'Shooting and editing short-form event reels that actually get watched.',
        venue: 'Media Room',
        start: days(15), end: days(15),
        status: 'published', visibility: 'public',
        registrationDeadline: days(13),
      },
      {
        title: 'Fest Coverage Briefing',
        type: 'Meetup',
        description: 'Internal briefing for members shooting the upcoming cultural fest — shot list and shift slots.',
        venue: 'Club Room',
        start: days(18), end: days(18),
        status: 'draft', visibility: 'club_only',
        registrationDeadline: days(17),
      },
    ],
    'Cultural Club': [
      {
        title: "Rangmanch — Annual Cultural Fest",
        type: 'Cultural Fest',
        description: 'The flagship two-day fest — music, dance, drama, and street play competitions.',
        venue: 'Open Air Theatre',
        start: days(30), end: days(31),
        status: 'published', visibility: 'public',
        registrationDeadline: days(25),
      },
      {
        title: 'Open Mic Night',
        type: 'Meetup',
        description: 'Poetry, stand-up, and music — sign up for a 5-minute slot at the door.',
        venue: 'Amphitheatre',
        start: days(9), end: days(9),
        status: 'published', visibility: 'public',
        registrationDeadline: days(8),
      },
      {
        title: 'Dance Auditions',
        type: 'Meetup',
        description: 'Auditions for the fest dance crew — freestyle + choreography round.',
        venue: 'Dance Studio',
        start: days(-7), end: days(-7),
        status: 'completed', visibility: 'club_only',
        registrationDeadline: days(-9),
      },
    ],
    'Entrepreneurship Cell': [
      {
        title: "Founders' Fireside Chat",
        type: 'Guest Talk',
        description: 'An alumni founder on what actually breaks in the first year of a startup.',
        venue: 'Auditorium',
        start: days(11), end: days(11),
        status: 'published', visibility: 'public',
        registrationDeadline: days(10),
      },
      {
        title: 'Startup Pitch Bootcamp',
        type: 'Workshop',
        description: 'Two-hour crash course on building a pitch deck before Pitch Day.',
        venue: 'E-Cell Office',
        start: days(17), end: days(17),
        status: 'published', visibility: 'public',
        registrationDeadline: days(15),
      },
      {
        title: 'E-Cell Orientation Meetup',
        type: 'Meetup',
        description: "New-member orientation — what E-Cell does and how to get involved.",
        venue: 'Seminar Hall A',
        start: days(-3), end: days(-3),
        status: 'completed', visibility: 'public',
        registrationDeadline: days(-5),
      },
    ],
  };
}

async function ensureOrganizer(clubName, clubId) {
  const demo = DEMO_ORGANIZERS[clubName];
  if (!demo) return null; // Coding Club: use its existing real organizer instead

  const existing = await Organizer.findByEmail(demo.email);
  if (existing) {
    console.log(`  = organizer ${demo.email} (already exists)`);
    return existing;
  }
  const created = await Organizer.create({
    name: demo.name,
    email: demo.email,
    password: DEMO_PASSWORD,
    clubId,
  });
  console.log(`  + organizer ${demo.email} for ${clubName}`);
  return created;
}

async function findEventByClubAndTitle(clubId, title) {
  const { rows } = await pool.query(
    `SELECT * FROM events WHERE club_id = $1 AND title = $2`,
    [clubId, title]
  );
  return rows[0] || null;
}

async function seed() {
  const today = new Date();

  console.log('Loading clubs, event types...');
  const clubs = await Club.findAll();
  const eventTypes = await EventType.findAll();
  const typeIdByName = Object.fromEntries(eventTypes.map((t) => [t.name, t.id]));

  if (clubs.length === 0) {
    throw new Error('No clubs found — run `node seed.js` first to seed clubs/event_types.');
  }

  console.log('\nEnsuring demo organizers...');
  const organizerByClub = {};
  for (const club of clubs) {
    if (club.name === 'Coding Club') {
      const orgs = await Club.getOrganizers(club.id);
      organizerByClub[club.name] = orgs[0] || null; // use the real existing organizer
      if (!orgs[0]) console.log(`  ! Coding Club has no organizer — its events will have organizer_id = NULL`);
      continue;
    }
    organizerByClub[club.name] = await ensureOrganizer(club.name, club.id);
  }

  console.log('\nSeeding demo events...');
  const plan = buildEventPlan(today);
  let created = 0, skipped = 0;

  for (const club of clubs) {
    const events = plan[club.name];
    if (!events) {
      console.log(`  ! No demo events planned for "${club.name}" (not in seed plan) — skipping`);
      continue;
    }
    const organizer = organizerByClub[club.name];

    for (const ev of events) {
      const existing = await findEventByClubAndTitle(club.id, ev.title);
      if (existing) {
        console.log(`  = ${club.name}: "${ev.title}" (already exists)`);
        skipped++;
        continue;
      }
      const eventTypeId = typeIdByName[ev.type];
      if (!eventTypeId) {
        console.log(`  ! Unknown event type "${ev.type}" for "${ev.title}" — skipping`);
        continue;
      }

      const row = await Event.create({
        clubId: club.id,
        organizerId: organizer ? organizer.id : null,
        eventTypeId,
        title: ev.title,
        description: ev.description,
        venue: ev.venue,
        startTime: ev.start,
        endTime: ev.end,
        bannerUrl: null,
        visibility: ev.visibility,
        registrationDeadline: ev.registrationDeadline,
      });

      if (ev.status !== 'draft') {
        await Event.updateStatus(row.id, ev.status);
      }

      console.log(`  + ${club.name}: "${ev.title}" [${ev.type}, ${ev.status}, ${ev.visibility}]`);
      created++;
    }
  }

  console.log(`\nDone. ${created} event(s) created, ${skipped} already existed.`);
  await pool.end();
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await pool.end();
  process.exit(1);
});
