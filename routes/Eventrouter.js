const express = require('express');
const eventController = require('../controllers/eventController');
const subEventController = require('../controllers/subEventController');
const { requireEventManager } = require('../middleware/auth');

const eventRouter = express.Router();

eventRouter.get('/', eventController.listEvents);
eventRouter.get('/:id', eventController.showEvent);
eventRouter.post('/:id/register', eventController.register);

// Volunteer team picker — pick which of the event's teams to join, no
// approval needed. Student-only; checked inside the controller.
eventRouter.get('/:id/volunteer-teams', eventController.volunteerTeamsPage);
eventRouter.post('/:id/volunteer-teams', eventController.joinTeams);

// Host-side QR check-in/check-out — gated by requireEventManager (the
// owning club's organizer OR this event's own event head), same as the
// sub-event scan routes below. Param renamed :eventId (from :id) so
// requireEventManager can resolve req.eventContainer the same way it does
// for every other route that uses it.
eventRouter.get('/:eventId/scan', requireEventManager, eventController.scanPage);
eventRouter.post('/:eventId/checkin', requireEventManager, eventController.checkin);

/*
  Student-facing sub-event routes — mirror the flagship routes above,
  scoped one level deeper. :id above becomes :eventId here so
  requireEventManager (shared with clubEventRouter's management routes)
  can resolve req.eventContainer the same way for both.

  Sub-event scan/check-in is gated by requireEventManager rather than
  requireOrganizer — a sub-event's own event head needs to be able to
  scan its attendees too, not just the club's organizer.
*/
eventRouter.get('/:eventId/sub-events/:subEventId', subEventController.showSubEvent);
eventRouter.post('/:eventId/sub-events/:subEventId/register', subEventController.register);
eventRouter.get('/:eventId/sub-events/:subEventId/volunteer-teams', subEventController.volunteerTeamsPage);
eventRouter.post('/:eventId/sub-events/:subEventId/volunteer-teams', subEventController.joinTeams);
eventRouter.get('/:eventId/sub-events/:subEventId/scan', requireEventManager, subEventController.scanPage);
eventRouter.post('/:eventId/sub-events/:subEventId/checkin', requireEventManager, subEventController.checkin);

module.exports = eventRouter;