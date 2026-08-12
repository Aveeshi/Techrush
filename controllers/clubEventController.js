const Event = require('../models/Event');
const SubEvent = require('../models/SubEvent');
const EventHead = require('../models/EventHead');
const EventType = require('../models/Eventtype');
const ClubMember = require('../models/Clubmember');
const Team = require('../models/Team');
const Group = require('../models/Group');
const Task = require('../models/Task');
const TaskAssignment = require('../models/Taskassignment');
const EventRegistration = require('../models/Eventregistration');
const EventImage = require('../models/EventImage');
const SkillTag = require('../models/Skilltag');

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Shared by both the "new event" and "new sub-event" forms — the
// searchable event-head picker needs the full club roster (organizer's
// own name included, since they're a club member too) plus the event
// type dropdown.
async function getEventFormData(clubId) {
  const [members, eventTypes] = await Promise.all([
    ClubMember.listMembers(clubId),
    EventType.findAll(),
  ]);
  return { members, eventTypes };
}

const clubEventController = {
  // GET /club-events — every event for this organizer's club, each with
  // its sub-events nested underneath.
  async listClubEvents(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }
      const events = await Event.findByClub(req.user.club_id);
      const subEventsByEvent = await SubEvent.findByEvents(events.map((e) => e.id));
      const eventsWithSubEvents = events.map((event) => ({
        ...event,
        subEvents: subEventsByEvent.get(event.id) || [],
      }));
      res.render('organizer/club-events', { events: eventsWithSubEvents });
    } catch (err) {
      next(err);
    }
  },

  // GET /my-events — the student-facing counterpart to listClubEvents:
  // only the events/sub-events THIS student heads (not the whole club's
  // events, which stays organizer-only). Each card links straight into
  // the existing /club-events/:eventId (or .../sub-events/:subEventId)
  // management page — already reachable by event heads today via
  // requireEventManager, this route just gives them a way to find it.
  // GET /my-events — the ONE combined tab for both roles (a student who's
  // both an event head and a team head doesn't get two separate tabs/
  // pages — see the earlier mistake this replaces). Two sections:
  // "Events I head" (EventHead.findContainersForStudent) and "Teams I
  // head" (Team.findHeadedByStudent), with the second deduped against the
  // first — if you already head a team's own container (event or
  // sub-event), that container's card already covers "manage this
  // container's teams" (requireTeamHead's EventHead OR-branch gives you
  // full authority over every team under it, default or not), so listing
  // that same team again as its own card would just be the same
  // authority shown twice.
  async myEvents(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const [containers, headedTeams, volunteerEvents, volunteerSubEvents] = await Promise.all([
        EventHead.findContainersForStudent(req.user.id),
        Team.findHeadedByStudent(req.user.id),
        Team.findEventsForStudent(req.user.id),
        Team.findSubEventsForStudent(req.user.id),
      ]);

      // One card per container (event or sub-event) the student has ANY
      // relationship with, tagged with EVERY role they hold there —
      // EVENT HEAD / SUB-EVENT HEAD / TEAM HEAD / VOLUNTEER. Replaces
      // what used to be two separate tabs (the old standalone "Teams"
      // page, and this "My Events & Teams" page) plus the old dedup-by-
      // hiding approach — now the overlap shows as multiple tags on one
      // card instead of the card being hidden.
      //
      // A sub-event under an event this student ALREADY heads never gets
      // its own card, in ANY role (head/team-head/volunteer) — main event
      // heads inherit every authority a sub-event's own head has (see
      // EventHead.isEventHeadOfSubEvent), so that sub-event is already
      // fully reachable/manageable by clicking through the main event's
      // card; a separate card for it would just be the same thing twice.
      const mainEventHeadIds = new Set(containers.filter((c) => c.type === 'event').map((c) => c.id));
      const isCoveredByMainEvent = (parentEventId) => parentEventId && mainEventHeadIds.has(parentEventId);

      const cards = new Map();
      const getCard = (key, seed) => {
        if (!cards.has(key)) cards.set(key, { ...seed, tags: new Set() });
        return cards.get(key);
      };

      containers.forEach((c) => {
        if (c.type === 'sub_event' && isCoveredByMainEvent(c.parent_event_id)) return;
        const key = `${c.type}:${c.id}`;
        const card = getCard(key, {
          type: c.type, id: c.id, parentEventId: c.parent_event_id,
          title: c.title, startTime: c.start_time, clubName: c.club_name,
        });
        card.tags.add(c.type === 'sub_event' ? 'SUB-EVENT HEAD' : 'EVENT HEAD');
      });

      headedTeams.forEach((t) => {
        const type = t.container_type;
        const id = type === 'sub_event' ? t.sub_event_id : t.event_id;
        if (type === 'sub_event' && isCoveredByMainEvent(t.sub_event_parent_id)) return;
        const key = `${type}:${id}`;
        const card = getCard(key, {
          type, id, parentEventId: t.sub_event_parent_id,
          title: t.container_title, startTime: t.container_start_time, clubName: t.club_name,
        });
        card.tags.add('TEAM HEAD');
      });

      volunteerEvents.forEach((e) => {
        const key = `event:${e.event_id}`;
        const card = getCard(key, {
          type: 'event', id: e.event_id, parentEventId: null,
          title: e.event_title, startTime: e.event_start_time, clubName: e.club_name,
        });
        card.tags.add('VOLUNTEER');
      });

      volunteerSubEvents.forEach((se) => {
        if (isCoveredByMainEvent(se.event_id)) return;
        const key = `sub_event:${se.sub_event_id}`;
        const card = getCard(key, {
          type: 'sub_event', id: se.sub_event_id, parentEventId: se.event_id,
          title: se.sub_event_title, startTime: se.sub_event_start_time, clubName: se.club_name,
        });
        card.tags.add('VOLUNTEER');
      });

      const merged = Array.from(cards.values())
        .map((c) => ({ ...c, tags: Array.from(c.tags) }))
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      res.render('my-events', { cards: merged });
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/new
  async newEventForm(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }
      const formData = await getEventFormData(req.user.club_id);
      res.render('organizer/event-form', { mode: 'create', containerType: 'event', event: null, parentEvent: null, errors: [], ...formData });
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events — creates the event, then assigns the picked event
  // head. The organizer can pick themselves — they're in the members
  // list too. No team is auto-created here — a fresh event starts with
  // zero teams; organizers add their own via "+ Add team" on the
  // management page, and a single fallback "default" team (named after
  // the event) only ever gets created lazily, the first time a volunteer
  // registers for an event that still has none (see eventController.js's
  // volunteerTeamsPage). An event head's authority over every team under
  // their event already comes from EventHead.isEventHead (see
  // middleware/auth.js's requireTeamHead) — they don't need an explicit
  // team_heads row on top of that.
  async createEvent(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }
      const { title, description, venue, startTime, endTime, bannerUrl, eventTypeId, visibility, registrationDeadline, eventHeadStudentId, creditHours } = req.body;

      if (!title || !startTime || !endTime) {
        const formData = await getEventFormData(req.user.club_id);
        return res.status(400).render('organizer/event-form', {
          mode: 'create', containerType: 'event', event: req.body, parentEvent: null,
          errors: ['Title, start time, and end time are required'], ...formData,
        });
      }

      const event = await Event.create({
        clubId: req.user.club_id,
        organizerId: req.user.id,
        eventTypeId: eventTypeId || null,
        title, description, venue, startTime, endTime,
        bannerUrl: bannerUrl || null,
        visibility: visibility || 'public',
        registrationDeadline: registrationDeadline || null,
        creditHours: creditHours || null,
      });

      await saveEventImages(event.id, req.files);

      if (eventHeadStudentId) {
        await EventHead.assign({ eventId: event.id, studentId: eventHeadStudentId, assignedBy: req.user.id });
        notifyRoleUpdated(req, eventHeadStudentId);
      }

      res.redirect(`/club-events/${event.id}`);
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/:eventId — management view. requireEventManager
  // (router-level) already resolved req.eventContainer for us.
  async eventDetail(req, res, next) {
    try {
      const event = req.eventContainer.row;
      const [subEvents, teams, heads, attendees, skillTags] = await Promise.all([
        SubEvent.findByEvent(event.id),
        Team.findByEvent(event.id),
        EventHead.listFor({ eventId: event.id }),
        EventRegistration.findByEvent(event.id),
        SkillTag.findAll(),
      ]);
      const requiredSkillsByTeam = await SkillTag.getRequiredSkillsForTeams(teams.map((t) => t.id));
      const teamsWithMembers = await Promise.all(
        teams.map(async (team) => ({
          ...team,
          members: await Team.listMembers(team.id),
          heads: await Team.getHeads(team.id),
          requiredSkills: requiredSkillsByTeam[team.id] || [],
        }))
      );
      res.render('organizer/event-detail', {
        containerType: 'event', event, parentEvent: null, subEvents, teams: teamsWithMembers, heads, skillTags,
        attendees: attendees.filter((r) => r.registration_type === 'attendee'),
        manageBasePath: `/club-events/${event.id}`,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/:eventId/edit
  async editEventForm(req, res, next) {
    try {
      const event = req.eventContainer.row;
      const formData = await getEventFormData(event.club_id);
      res.render('organizer/event-form', { mode: 'edit', containerType: 'event', event, parentEvent: null, errors: [], ...formData });
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events/:eventId/edit
  async updateEvent(req, res, next) {
    try {
      const { title, description, venue, startTime, endTime, bannerUrl, eventTypeId, visibility, registrationDeadline, creditHours } = req.body;
      await Event.update(req.params.eventId, {
        title, description, venue, startTime, endTime,
        bannerUrl, eventTypeId: eventTypeId || null, visibility, registrationDeadline: registrationDeadline || null,
        creditHours: creditHours || null,
      });
      await saveEventImages(req.params.eventId, req.files);
      res.redirect(`/club-events/${req.params.eventId}`);
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events/:eventId/publish  AND  .../sub-events/:subEventId/publish
  // Toggles draft <-> published — this is what actually makes an event/
  // sub-event show up on the student-facing /events feed and sub-event
  // grid (both already filter on status='published', see Event.js/
  // SubEvent.js), so nothing else needs to change once this flips.
  // Organizer-only: requireEventManager (router-level) also lets event
  // heads through, but publishing is a club-ownership decision, not part
  // of the day-to-day info/teams/tasks an event head runs.
  async togglePublish(req, res, next) {
    try {
      if (req.user.type !== 'organizer') {
        return res.status(403).send('Only the organizing club can publish or unpublish an event');
      }
      const { type, row } = req.eventContainer;
      const nextStatus = row.status === 'published' ? 'draft' : 'published';
      if (type === 'event') {
        await Event.updateStatus(row.id, nextStatus);
      } else {
        await SubEvent.updateStatus(row.id, nextStatus);
      }
      res.redirect(manageUrl(req));
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/:eventId/sub-events/new
  async newSubEventForm(req, res, next) {
    try {
      const event = req.eventContainer.row;
      const formData = await getEventFormData(event.club_id);
      res.render('organizer/event-form', { mode: 'create', containerType: 'sub_event', event: null, parentEvent: event, errors: [], ...formData });
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events/:eventId/sub-events
  async createSubEvent(req, res, next) {
    try {
      const event = req.eventContainer.row;
      const { title, description, venue, startTime, endTime, bannerUrl, eventTypeId, registrationDeadline, eventHeadStudentId, creditHours } = req.body;

      if (!title || !startTime || !endTime) {
        const formData = await getEventFormData(event.club_id);
        return res.status(400).render('organizer/event-form', {
          mode: 'create', containerType: 'sub_event', event: req.body, parentEvent: event,
          errors: ['Title, start time, and end time are required'], ...formData,
        });
      }

      const subEvent = await SubEvent.create({
        eventId: event.id,
        eventTypeId: eventTypeId || null,
        title, description, venue, startTime, endTime,
        bannerUrl: bannerUrl || null,
        registrationDeadline: registrationDeadline || null,
        createdBy: req.user.type === 'organizer' ? req.user.id : null,
        creditHours: creditHours || null,
      });

      const assignedBy = req.user.type === 'organizer' ? req.user.id : req.eventContainer.row.created_by;

      if (eventHeadStudentId) {
        await EventHead.assign({ subEventId: subEvent.id, studentId: eventHeadStudentId, assignedBy });
        notifyRoleUpdated(req, eventHeadStudentId);
      }

      res.redirect(`/club-events/${event.id}/sub-events/${subEvent.id}`);
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/:eventId/sub-events/:subEventId
  async subEventDetail(req, res, next) {
    try {
      const subEvent = req.eventContainer.row;
      const [teams, heads, attendees, skillTags] = await Promise.all([
        Team.findBySubEvent(subEvent.id),
        EventHead.listFor({ subEventId: subEvent.id }),
        EventRegistration.findBySubEvent(subEvent.id),
        SkillTag.findAll(),
      ]);
      const requiredSkillsByTeam = await SkillTag.getRequiredSkillsForTeams(teams.map((t) => t.id));
      const teamsWithMembers = await Promise.all(
        teams.map(async (team) => ({
          ...team,
          members: await Team.listMembers(team.id),
          heads: await Team.getHeads(team.id),
          requiredSkills: requiredSkillsByTeam[team.id] || [],
        }))
      );
      res.render('organizer/event-detail', {
        containerType: 'sub_event', event: subEvent, parentEvent: { id: subEvent.event_id, title: subEvent.event_title },
        subEvents: [], teams: teamsWithMembers, heads, skillTags,
        attendees: attendees.filter((r) => r.registration_type === 'attendee'),
        manageBasePath: `/club-events/${subEvent.event_id}/sub-events/${subEvent.id}`,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /club-events/:eventId/sub-events/:subEventId/edit
  async editSubEventForm(req, res, next) {
    try {
      const subEvent = req.eventContainer.row;
      const formData = await getEventFormData(subEvent.club_id);
      res.render('organizer/event-form', {
        mode: 'edit', containerType: 'sub_event', event: subEvent,
        parentEvent: { id: subEvent.event_id, title: subEvent.event_title }, errors: [], ...formData,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events/:eventId/sub-events/:subEventId/edit
  async updateSubEvent(req, res, next) {
    try {
      const { title, description, venue, startTime, endTime, bannerUrl, eventTypeId, registrationDeadline, creditHours } = req.body;
      await SubEvent.update(req.params.subEventId, {
        title, description, venue, startTime, endTime,
        bannerUrl, eventTypeId: eventTypeId || null, registrationDeadline: registrationDeadline || null,
        creditHours: creditHours || null,
      });
      res.redirect(`/club-events/${req.params.eventId}/sub-events/${req.params.subEventId}`);
    } catch (err) {
      next(err);
    }
  },

  // POST /club-events/:eventId/teams  AND  .../sub-events/:subEventId/teams
  // Whoever passed requireEventManager (organizer of the club, or this
  // container's event head) can add a team beyond the 5 auto-provisioned
  // standard ones.
  async createTeam(req, res, next) {
    try {
      const { type, row } = req.eventContainer;
      const { name, description, maxSize, skillTagIds } = req.body;
      if (name && name.trim()) {
        const team = await Team.create({
          eventId: type === 'event' ? row.id : undefined,
          subEventId: type === 'sub_event' ? row.id : undefined,
          name: name.trim(),
          description: description || null,
          // Optional cap set by whoever creates the team — blank input
          // means unlimited, same as leaving it out entirely.
          maxSize: maxSize && Number(maxSize) > 0 ? Number(maxSize) : null,
          createdBy: req.user.type === 'organizer' ? req.user.id : null,
        });
        // Same skill_tags vocabulary/checkbox format as student signup —
        // see SkillTag.setTeamRequiredSkills.
        await SkillTag.setTeamRequiredSkills(team.id, toArray(skillTagIds));
      }
      res.redirect(manageUrl(req));
    } catch (err) {
      next(err);
    }
  },

  // POST .../teams/:teamId/head — same authority as an organizer assigning
  // a team head today (Team.assignHead), just also reachable by this
  // container's event head, not only the club's organizer.
  async assignTeamHead(req, res, next) {
    try {
      const { teamId } = req.params;
      const { studentId } = req.body;
      if (studentId) {
        await Team.assignHead(teamId, studentId, req.user.type === 'organizer' ? req.user.id : null);
      }
      res.redirect(manageUrl(req));
    } catch (err) {
      next(err);
    }
  },

  // POST .../teams/:teamId/tasks — creates a task for the team, then
  // bulk-assigns it either to every current team member ("whole team") or
  // to just the checked ones ("specific volunteers") via the existing
  // generic TaskAssignment.assignBulk — no new assignment primitive needed,
  // whole-team is just "the checkbox list happens to be everyone."
  async createTask(req, res, next) {
    try {
      const { teamId } = req.params;
      const { title, description, assignedHours, dueAt, assignMode, studentIds } = req.body;

      if (!title || !assignedHours) {
        return res.redirect(manageUrl(req));
      }

      const group = await Group.findByTeam(teamId);
      const task = await Task.create({
        groupId: group.id,
        title,
        description: description || null,
        assignedHours,
        domainTags: null,
        createdBy: req.user.id,
        createdByType: req.user.type === 'organizer' ? 'organizer' : 'team_head',
        dueAt: dueAt || null,
      });

      const targetIds = assignMode === 'whole_team'
        ? (await Team.listMembers(teamId)).map((m) => m.id)
        : toArray(studentIds);

      if (targetIds.length) {
        // assigned_by is a students(id) FK — an organizer has no row there,
        // so it's left null for organizer-created tasks (see TaskAssignment.js).
        await TaskAssignment.assignBulk(task.id, targetIds, req.user.type === 'student' ? req.user.id : null);
      }

      res.redirect(manageUrl(req));
    } catch (err) {
      next(err);
    }
  },
};

// Redirects back to whichever management page (event or sub-event) the
// request came from, after a team/head/task action.
function manageUrl(req) {
  const { type, row } = req.eventContainer;
  return type === 'event'
    ? `/club-events/${row.id}`
    : `/club-events/${row.event_id}/sub-events/${row.id}`;
}

// Pushes 'role:updated' to a student's own socket room the instant they're
// assigned as event head (or, in teamController.js/authController.js's
// equivalent calls, team head) — this is what lets views/partials/nav.ejs's
// "My Events"/"Event Head" chip appear live, no reload, for a student
// already sitting on a page when the assignment happens. req.app.get('io')
// is set once in app.js (app.set('io', io)).
function notifyRoleUpdated(req, studentId) {
  req.app.get('io').to(`user:${studentId}`).emit('role:updated');
}

// Handles the two file fields the event-form's Cloudinary upload
// middleware (see routes/clubEventRouter.js's eventImageUpload.fields())
// parses into req.files: `primaryImage` (single, becomes the card
// thumbnail) and `additionalImages` (the rest of the gallery). Each
// multer-storage-cloudinary file already has `.path` set to the uploaded
// image's Cloudinary URL — nothing else needs to touch Cloudinary
// directly. Syncing events.banner_url to the primary image means every
// existing "show the banner" template (events.ejs, registered-events.ejs,
// teams.ejs, ...) already renders the right thing with zero changes.
async function saveEventImages(eventId, files) {
  const primaryFile = files?.primaryImage?.[0];
  const additionalFiles = files?.additionalImages || [];

  if (primaryFile) {
    const image = await EventImage.create({ eventId, url: primaryFile.path, isPrimary: true, sortOrder: 0 });
    await EventImage.setPrimary(eventId, image.id);
    await Event.update(eventId, { bannerUrl: primaryFile.path });
  }

  await Promise.all(additionalFiles.map((file, i) =>
    EventImage.create({ eventId, url: file.path, isPrimary: false, sortOrder: i + 1 })
  ));
}

module.exports = clubEventController;
module.exports.notifyRoleUpdated = notifyRoleUpdated;
