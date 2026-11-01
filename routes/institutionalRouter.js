const express = require('express');
const institutionalController = require('../controllers/institutionalController');
const { requireInstitutional } = require('../middleware/auth');

const router = express.Router();

// All institutional routes require active Institutional Coordinator session
router.use(requireInstitutional);

// Institution-wide Dashboard (Requirement 2 & 6: View all clubs)
router.get('/dashboard', institutionalController.dashboard);

// Central report redirect
router.get('/reports', institutionalController.reportsOverview);

// View individual student semester report
router.get('/reports/:reportId', institutionalController.viewSemesterReport);

// Individual Club Dossier (FC, Student Coordinators, All events, member contributions, and attendance)
router.get('/clubs/:clubId', institutionalController.clubDetails);

// Club Activity & Accreditation Report Generator (timeframe, event, monthly, yearly filters)
router.get('/clubs/:clubId/report', institutionalController.clubReport);

// Deep-dive Member Contribution Inspection in this club
router.get('/clubs/:clubId/members/:studentId', institutionalController.memberContributions);

// Event Details with full attendee roster
router.get('/events/:eventId', institutionalController.eventDetails);

module.exports = router;
