const express = require('express');
const clubEventController = require('../controllers/clubEventController');
const { requireOrganizer, requireEventManager } = require('../middleware/auth');
const { makeUploader } = require('../utils/cloudinary');

const clubEventRouter = express.Router();

// Flagship-event image uploads — a single primary/thumbnail plus up to 9
// additional gallery images, both streamed straight to Cloudinary (see
// utils/cloudinary.js) before the route handler ever runs; req.files.
// primaryImage[0]/.additionalImages carry the resulting URLs (see
// clubEventController's saveEventImages). Sub-events don't get this — no
// gallery for them, per the original scope of this feature.
const eventImageUpload = makeUploader('events').fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'additionalImages', maxCount: 9 },
]);

/*
  Mounted at /club-events in app.js.

  Creating a TOP-LEVEL event is organizer-only (requireOrganizer) — there's
  no event yet to be an event head OF. Everything scoped to an existing
  event/sub-event (viewing, editing, adding sub-events, and — in
  Phase 5 — team/task management) goes through requireEventManager, which
  lets in either the owning club's organizer OR that specific container's
  event head (see middleware/auth.js). '/new' is registered before
  '/:eventId' so it isn't swallowed as a literal :eventId.
*/

clubEventRouter.get('/', requireOrganizer, clubEventController.listClubEvents);
clubEventRouter.get('/new', requireOrganizer, clubEventController.newEventForm);
clubEventRouter.post('/', requireOrganizer, eventImageUpload, clubEventController.createEvent);

clubEventRouter.get('/:eventId', requireEventManager, clubEventController.eventDetail);
clubEventRouter.get('/:eventId/edit', requireEventManager, clubEventController.editEventForm);
clubEventRouter.post('/:eventId/edit', requireEventManager, eventImageUpload, clubEventController.updateEvent);
clubEventRouter.post('/:eventId/publish', requireEventManager, clubEventController.togglePublish);

clubEventRouter.get('/:eventId/sub-events/new', requireEventManager, clubEventController.newSubEventForm);
clubEventRouter.post('/:eventId/sub-events', requireEventManager, clubEventController.createSubEvent);
clubEventRouter.get('/:eventId/sub-events/:subEventId', requireEventManager, clubEventController.subEventDetail);
clubEventRouter.get('/:eventId/sub-events/:subEventId/edit', requireEventManager, clubEventController.editSubEventForm);
clubEventRouter.post('/:eventId/sub-events/:subEventId/edit', requireEventManager, clubEventController.updateSubEvent);
clubEventRouter.post('/:eventId/sub-events/:subEventId/publish', requireEventManager, clubEventController.togglePublish);

// Team / team-head / task management — reachable by the club's organizer
// OR this specific container's event head (requireEventManager covers
// both; see middleware/auth.js). Duplicated once per container type
// (event vs sub-event) so the URLs stay readable; the controller itself
// is shared (see req.eventContainer usage in clubEventController.js).
clubEventRouter.post('/:eventId/teams', requireEventManager, clubEventController.createTeam);
clubEventRouter.post('/:eventId/teams/:teamId/head', requireEventManager, clubEventController.assignTeamHead);
clubEventRouter.post('/:eventId/teams/:teamId/tasks', requireEventManager, clubEventController.createTask);

clubEventRouter.post('/:eventId/sub-events/:subEventId/teams', requireEventManager, clubEventController.createTeam);
clubEventRouter.post('/:eventId/sub-events/:subEventId/teams/:teamId/head', requireEventManager, clubEventController.assignTeamHead);
clubEventRouter.post('/:eventId/sub-events/:subEventId/teams/:teamId/tasks', requireEventManager, clubEventController.createTask);

module.exports = clubEventRouter;
