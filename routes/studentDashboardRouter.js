const express = require('express');
const studentDashboardController = require('../controllers/studentDashboardController');
const { requireStudent, requireStudentOrInspector, requireAuth } = require('../middleware/auth');

const router = express.Router();

// Student's own dashboard
router.get('/dashboard', requireStudent, studentDashboardController.dashboard);

// Inspect a student's dashboard (strictly controlled by requireStudentOrInspector)
router.get('/dashboard/:studentId', requireStudentOrInspector, studentDashboardController.dashboard);

// Priority Club selection
router.post('/priority-club', requireStudent, studentDashboardController.setPriorityClub);

// Semester Report Generator & Submission
router.get('/semester-report', requireStudent, studentDashboardController.semesterReportPage);
router.post('/semester-report/submit', requireStudent, studentDashboardController.submitSemesterReport);
router.get('/semester-report/:reportId/view', requireAuth, studentDashboardController.viewSemesterReport);

// 4-Year Cumulative Graduation Report / Club Dossier (Requirement 5)
router.get('/graduation-report', requireStudent, studentDashboardController.graduationReport);
router.get('/graduation-report/:studentId', requireStudentOrInspector, studentDashboardController.graduationReport);

// Yearly Memory Summary / Keepsake Certificate (Requirement 5)
router.get('/yearly-summary', requireStudent, studentDashboardController.yearlySummary);
router.get('/yearly-summary/:studentId', requireStudentOrInspector, studentDashboardController.yearlySummary);

module.exports = router;
