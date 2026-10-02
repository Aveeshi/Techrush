const express = require('express');
const institutionalController = require('../controllers/institutionalController');
const { requireInstitutional } = require('../middleware/auth');

const router = express.Router();

// All institutional routes require active Institutional Coordinator session
router.use(requireInstitutional);

// Institution-wide Dashboard (Requirement 2 & 6: View all clubs)
router.get('/dashboard', institutionalController.dashboard);

// Individual Club Dossier (FC, Student Coordinators, All events, summaries, and attendance)
router.get('/clubs/:clubId', institutionalController.clubDetails);

// Event Details with full attendee roster
router.get('/events/:eventId', institutionalController.eventDetails);

module.exports = router;
