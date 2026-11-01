const express = require('express');
const facultyController = require('../controllers/facultyController');
const { requireFaculty } = require('../middleware/auth');

const router = express.Router();

// All faculty routes require active Faculty Coordinator session
router.use(requireFaculty);

// Dashboard
router.get('/dashboard', facultyController.dashboard);

// Event Approval & Permission (Requirement 3)
router.get('/events', facultyController.events);
router.post('/events/:eventId/approve', facultyController.approveEvent);
router.post('/events/:eventId/reject', facultyController.rejectEvent);
router.get('/events/:eventId/attendees', facultyController.eventAttendees);

// Student Semester Reports Verification (Requirement 3: Tick, Cross, Send back)
router.get('/reports', facultyController.reports);
router.get('/reports/:reportId', facultyController.reviewReport);
router.post('/reports/:reportId/verify', facultyController.verifyReport);

// Student Coordinators Assignment (Requirement 3)
router.get('/coordinators', facultyController.coordinators);
router.post('/coordinators/assign', facultyController.assignCoordinator);
router.post('/coordinators/:studentId/remove', facultyController.removeCoordinator);

// Timeframe Report Generator: Yearly, Monthly, Weekly, or Single Event (Requirement 4)
router.get('/generate-report', facultyController.generateReportPage);

module.exports = router;
