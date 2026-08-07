const Team = require('../models/Team');
const Event = require('../models/Event');
const SubEvent = require('../models/SubEvent');
const EventHead = require('../models/EventHead');

// Shared by requireTeamHead and canAccessTeam-adjacent checks: resolves the
// club_id that owns a team, whichever container (event or sub-event) it
// lives under — sub_events has no club_id column of its own, it's
// inherited from the parent event (see SubEvent.findByIdWithDetails).
async function clubIdForTeam(team) {
  if (team.event_id) {
    const event = await Event.findById(team.event_id);
    return event?.club_id ?? null;
  }
  const subEvent = await SubEvent.findByIdWithDetails(team.sub_event_id);
  return subEvent?.club_id ?? null;
}

// Blocks any unauthenticated request, regardless of type
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Login required' });
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.isAuthenticated() || req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student account required' });
  }
  next();
}

function requireOrganizer(req, res, next) {
  if (!req.isAuthenticated() || req.user.type !== 'organizer') {
    return res.status(403).json({ error: 'Organizer account required' });
  }
  next();
}

// Use on any route where a student or organizer must be able to manage the
// team named in req.params.teamId (creating/assigning tasks, marking
// attendance, verifying hours, assigning a head). Passes for ANY of:
//   - Team.isTeamHead(teamId, studentId) — the team's own head, OR
//   - EventHead.isEventHead(...) on that team's own container (event or
//     sub-event) — "an event head has all the authorities of team heads", OR
//   - the organizer of the club that owns the team's event/sub-event — the
//     organizer sits above event heads in this same hierarchy, so they
//     inherit every authority an event head (and therefore a team head) has.
// For a team under a sub-event, the event-head check is hierarchical (see
// EventHead.isEventHeadOfSubEvent) — the sub-event's own head OR its
// parent event's head, so a main event head can manage every team under
// every one of their sub-events too. Stashes the team row on req.team so
// the controller doesn't need to re-fetch it.
async function requireTeamHead(req, res, next) {
  if (!req.isAuthenticated() || (req.user.type !== 'student' && req.user.type !== 'organizer')) {
    return res.status(403).json({ error: 'Student or organizer account required' });
  }
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    let authorized = false;
    if (req.user.type === 'organizer') {
      const clubId = await clubIdForTeam(team);
      authorized = !!clubId && req.user.club_id === clubId;
    } else {
      const isHead = await Team.isTeamHead(teamId, req.user.id);
      let isEventHead;
      if (team.event_id) {
        isEventHead = await EventHead.isEventHead({ eventId: team.event_id }, req.user.id);
      } else {
        const subEvent = await SubEvent.findById(team.sub_event_id);
        isEventHead = subEvent ? await EventHead.isEventHeadOfSubEvent(subEvent, req.user.id) : false;
      }
      authorized = isHead || isEventHead;
    }

    if (!authorized) {
      return res.status(403).json({ error: 'Only this team\'s head (or its event head/organizer) can do that' });
    }

    req.team = team;
    next();
  } catch (err) {
    next(err);
  }
}

// The single authorization gate for managing an event OR a sub-event
// (creating teams, assigning team heads, editing info, authoring tasks,
// scanning QR codes, viewing attendees):
//   canManage = organizer of the owning club  OR  event head of THIS container
// For a sub-event, "event head of this container" is hierarchical — the
// sub-event's OWN head, OR the head of its parent (flagship) event (see
// EventHead.isEventHeadOfSubEvent) — a main event head automatically has
// every authority each of their sub-events' own heads has.
// Resolves the container from the URL (:eventId always; :subEventId only on
// sub-event-scoped routes) and stashes it on req.eventContainer so the
// controller doesn't have to re-fetch it — { type: 'event'|'sub_event', row }.
// This one check replaces needing separate organizer-only and
// event-head-only middlewares, since both roles hit the same routes, just
// scoped to whichever containers they individually pass for.
async function requireEventManager(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Login required' });
  }

  const { eventId, subEventId } = req.params;

  try {
    let container;
    if (subEventId) {
      const subEvent = await SubEvent.findByIdWithDetails(subEventId);
      if (!subEvent || subEvent.event_id !== eventId) {
        return res.status(404).json({ error: 'Sub-event not found' });
      }
      container = { type: 'sub_event', row: subEvent, clubId: subEvent.club_id };
    } else {
      const event = await Event.findByIdWithDetails(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      container = { type: 'event', row: event, clubId: event.club_id };
    }

    const isOrganizerOfClub = req.user.type === 'organizer' && req.user.club_id === container.clubId;
    const isHead = req.user.type === 'student' && (
      subEventId
        ? await EventHead.isEventHeadOfSubEvent(container.row, req.user.id)
        : await EventHead.isEventHead({ eventId }, req.user.id)
    );

    if (!isOrganizerOfClub && !isHead) {
      return res.status(403).json({ error: 'You do not manage this event' });
    }

    req.eventContainer = container;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireStudent, requireOrganizer, requireTeamHead, requireEventManager };