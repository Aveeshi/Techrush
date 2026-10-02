const FacultyCoordinator = require('../models/FacultyCoordinator');
const SemesterReport = require('../models/SemesterReport');
const Event = require('../models/Event');
const Club = require('../models/Club');
const ClubMember = require('../models/Clubmember');
const pool = require('../utils/db');

const facultyController = {
  // GET /faculty/dashboard
  async dashboard(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const club = await Club.findById(clubId);

      const pendingEvents = await Event.findPendingForFaculty(clubId);
      const allEvents = await Event.findAllForFaculty(clubId);
      const pendingReports = await SemesterReport.findByClub(clubId, 'pending');
      const allReports = await SemesterReport.findByClub(clubId);
      const studentCoordinators = await FacultyCoordinator.getStudentCoordinators(clubId);

      res.render('faculty/dashboard', {
        fc: req.user,
        club,
        pendingEvents,
        allEvents,
        pendingReports,
        allReports,
        studentCoordinators,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/events
  async events(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const club = await Club.findById(clubId);
      const pendingEvents = await Event.findPendingForFaculty(clubId);
      const allEvents = await Event.findAllForFaculty(clubId);

      res.render('faculty/events', {
        fc: req.user,
        club,
        pendingEvents,
        allEvents,
        message: req.query.msg || null,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /faculty/events/:eventId/approve
  async approveEvent(req, res, next) {
    try {
      const { remarks } = req.body;
      const event = await Event.findById(req.params.eventId);
      if (!event || event.club_id !== req.user.club_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await Event.approveByFaculty(req.params.eventId, req.user.id, remarks);
      res.redirect('/faculty/events?msg=Event+approved+and+permission+granted');
    } catch (err) {
      next(err);
    }
  },

  // POST /faculty/events/:eventId/reject
  async rejectEvent(req, res, next) {
    try {
      const { remarks } = req.body;
      const event = await Event.findById(req.params.eventId);
      if (!event || event.club_id !== req.user.club_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await Event.rejectByFaculty(req.params.eventId, req.user.id, remarks);
      res.redirect('/faculty/events?msg=Event+proposal+rejected');
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/reports
  async reports(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const club = await Club.findById(clubId);
      const filter = req.query.status || null;
      const reports = await SemesterReport.findByClub(clubId, filter);

      res.render('faculty/reports', {
        fc: req.user,
        club,
        reports,
        currentFilter: filter || 'all',
        message: req.query.msg || null,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/reports/:reportId
  async reviewReport(req, res, next) {
    try {
      const report = await SemesterReport.findById(req.params.reportId);
      if (!report || report.club_id !== req.user.club_id) {
        return res.status(404).render('not-found');
      }

      res.render('faculty/report-detail', {
        fc: req.user,
        report,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /faculty/reports/:reportId/verify
  // Actions: 'approve' (tick), 'reject' (cross), or 'reverification' (send back)
  async verifyReport(req, res, next) {
    try {
      const { action, fcRemarks } = req.body;
      const report = await SemesterReport.findById(req.params.reportId);
      if (!report || report.club_id !== req.user.club_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      let newStatus = 'approved';
      if (action === 'reject') newStatus = 'rejected';
      if (action === 'reverification') newStatus = 'reverification';

      await SemesterReport.updateStatus(report.id, {
        status: newStatus,
        fcRemarks: fcRemarks || (action === 'approve' ? 'Verified & Approved by Faculty Coordinator' : ''),
        verifiedBy: req.user.id,
      });

      res.redirect(`/faculty/reports?msg=Report+${newStatus}+successfully`);
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/coordinators
  async coordinators(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const club = await Club.findById(clubId);
      const studentCoordinators = await FacultyCoordinator.getStudentCoordinators(clubId);
      
      // All club members to choose from when assigning
      const membersRes = await pool.query(
        `SELECT s.id, s.name, s.email, s.roll_number, s.department, s.year
         FROM club_members cm
         JOIN students s ON s.id = cm.student_id
         WHERE cm.club_id = $1
         ORDER BY s.name ASC`,
        [clubId]
      );

      res.render('faculty/coordinators', {
        fc: req.user,
        club,
        studentCoordinators,
        clubMembers: membersRes.rows,
        message: req.query.msg || null,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /faculty/coordinators/assign
  async assignCoordinator(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const { studentId, roleTitle, taskDescription, canInspectRecords } = req.body;
      if (!studentId) {
        return res.redirect('/faculty/coordinators?error=missing_student');
      }

      await FacultyCoordinator.assignStudentCoordinator({
        clubId,
        studentId,
        assignedBy: req.user.id,
        roleTitle: roleTitle || 'Student Coordinator',
        taskDescription: taskDescription || 'Appointed by Faculty Coordinator',
        canInspect: canInspectRecords === 'on' || canInspectRecords === 'true',
      });

      res.redirect('/faculty/coordinators?msg=Student+coordinator+assigned+successfully');
    } catch (err) {
      next(err);
    }
  },

  // POST /faculty/coordinators/:studentId/remove
  async removeCoordinator(req, res, next) {
    try {
      const clubId = req.user.club_id;
      await FacultyCoordinator.removeStudentCoordinator(clubId, req.params.studentId);
      res.redirect('/faculty/coordinators?msg=Coordinator+role+revoked');
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/generate-report (Requirement 4: Yearly, Monthly, Weekly, or Individual Event Reports)
  async generateReportPage(req, res, next) {
    try {
      const clubId = req.user.club_id;
      const club = await Club.findById(clubId);
      const allEvents = await Event.findAllForFaculty(clubId);

      const timeframe = req.query.timeframe || 'monthly';
      const eventId = req.query.eventId || null;
      const year = req.query.year || new Date().getFullYear();
      const month = req.query.month || new Date().getMonth() + 1;

      let reportData = null;
      if (req.query.run === '1') {
        reportData = await Event.getClubReportByTimeframe(clubId, {
          timeframe,
          eventId,
          year: parseInt(year, 10),
          month: parseInt(month, 10),
        });
      }

      res.render('faculty/generate-report', {
        fc: req.user,
        club,
        allEvents,
        timeframe,
        eventId,
        year,
        month,
        reportData,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /faculty/events/:eventId/attendees
  async eventAttendees(req, res, next) {
    try {
      const event = await Event.findById(req.params.eventId);
      if (!event || event.club_id !== req.user.club_id) {
        return res.status(404).render('not-found');
      }

      const attendees = await Event.getAttendeesForEvent(event.id);
      res.render('faculty/event-attendees', {
        fc: req.user,
        event,
        attendees,
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = facultyController;
