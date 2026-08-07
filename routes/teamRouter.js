const express = require('express');
const teamController = require('../controllers/teamController');
const { requireTeamHead } = require('../middleware/auth');

const teamRouter = express.Router();

/*
  Mounted at /teams in app.js. All routes here are student-only — auth and
  team-membership checks happen inside the controller (mirroring how
  eventController does its own req.user checks rather than relying solely
  on router-level middleware).

  The /:teamId/manage subtree is gated by requireTeamHead — the unified
  authorization check that passes for this team's own head OR its
  container's event head (see middleware/auth.js) — so both dashboards
  land on the exact same management page.
*/

// The standalone "Teams" tab is gone — merged into /my-events (one card
// per event/sub-event you have ANY relationship with, tagged with every
// role you hold there — see clubEventController.myEvents). Kept as a
// redirect for anyone with the old link bookmarked.
teamRouter.get('/', (req, res) => res.redirect('/my-events'));
teamRouter.get('/event/:eventId', teamController.myTeamsForEvent);
teamRouter.get('/sub-event/:subEventId', teamController.myTeamsForSubEvent);
teamRouter.get('/:teamId/manage', requireTeamHead, teamController.teamManagePage);
teamRouter.post('/:teamId/head', requireTeamHead, teamController.assignHead);
teamRouter.post('/:teamId/tasks', requireTeamHead, teamController.createTask);
teamRouter.post('/:teamId/tasks/:taskId/complete', requireTeamHead, teamController.completeTask);
teamRouter.get('/:teamId', teamController.teamDetail);
teamRouter.post('/:teamId/chat', teamController.postChatMessage);
teamRouter.get('/:teamId/chat/messages', teamController.chatMessagesJson);

module.exports = teamRouter;
