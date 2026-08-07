// One-off migration: replace the old "5 standard teams" test scaffolding
// (Tech Team, Design & Decor, Content, Publicity, Operations — auto-
// provisioned on every event/sub-event) with exactly ONE default team per
// container, named after the event/sub-event itself. If a container
// already has an event head assigned, that student is added as a member
// and immediately promoted to head of the new default team.
//
// Deletes every existing team_members/team_heads/groups/teams row first
// (confirmed: none of the old standard teams have any tasks attached),
// then creates the new default teams from scratch. Not idempotent by
// design — meant to run exactly once against the pre-existing test data.
require('dotenv').config();
const pool = require('../utils/db');
const Team = require('../models/Team');
const EventHead = require('../models/EventHead');

async function wipeExistingTeams() {
  const { rows: teams } = await pool.query('SELECT id FROM teams');
  const teamIds = teams.map((t) => t.id);
  if (!teamIds.length) {
    console.log('No existing teams to remove.');
    return;
  }

  // Chat is scoped to teams too (team_channels, plus any ad-hoc
  // unofficial_groups a volunteer made) — both need their messages and
  // then themselves cleared before teams can be deleted.
  const { rows: channels } = await pool.query(
    `SELECT id FROM team_channels WHERE team_id = ANY($1::uuid[])
     UNION
     SELECT id FROM unofficial_groups WHERE team_id = ANY($1::uuid[])`,
    [teamIds]
  );
  const channelIds = channels.map((c) => c.id);
  if (channelIds.length) {
    await pool.query('DELETE FROM channel_messages WHERE channel_id = ANY($1::uuid[])', [channelIds]);
  }
  await pool.query('DELETE FROM unofficial_groups WHERE team_id = ANY($1::uuid[])', [teamIds]);
  await pool.query('DELETE FROM team_channels WHERE team_id = ANY($1::uuid[])', [teamIds]);

  await pool.query('DELETE FROM team_members WHERE team_id = ANY($1::uuid[])', [teamIds]);
  await pool.query('DELETE FROM team_heads WHERE team_id = ANY($1::uuid[])', [teamIds]);
  await pool.query('DELETE FROM groups WHERE team_id = ANY($1::uuid[])', [teamIds]);
  await pool.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
  console.log(`Removed ${teamIds.length} old team(s) and their memberships/chat.`);
}

async function createDefaultTeamsForEvents() {
  const { rows: events } = await pool.query('SELECT id, title, organizer_id FROM events');
  for (const event of events) {
    const team = await Team.create({ eventId: event.id, name: event.title, description: null, createdBy: event.organizer_id });
    const heads = await EventHead.listFor({ eventId: event.id });
    for (const head of heads) {
      await Team.addMember(team.id, head.student_id);
      await Team.assignHead(team.id, head.student_id, event.organizer_id);
    }
    console.log(`Event "${event.title}": default team created${heads.length ? `, head(s): ${heads.map((h) => h.name).join(', ')}` : ''}`);
  }
}

async function createDefaultTeamsForSubEvents() {
  const { rows: subEvents } = await pool.query('SELECT id, title, created_by FROM sub_events');
  for (const subEvent of subEvents) {
    const team = await Team.create({ subEventId: subEvent.id, name: subEvent.title, description: null, createdBy: subEvent.created_by });
    const heads = await EventHead.listFor({ subEventId: subEvent.id });
    for (const head of heads) {
      await Team.addMember(team.id, head.student_id);
      await Team.assignHead(team.id, head.student_id, subEvent.created_by);
    }
    console.log(`Sub-event "${subEvent.title}": default team created${heads.length ? `, head(s): ${heads.map((h) => h.name).join(', ')}` : ''}`);
  }
}

async function main() {
  try {
    await wipeExistingTeams();
    await createDefaultTeamsForEvents();
    await createDefaultTeamsForSubEvents();
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
