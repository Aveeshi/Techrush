const InstitutionalCoordinator = require('../models/InstitutionalCoordinator');
const Event = require('../models/Event');
const Club = require('../models/Club');

const institutionalController = {
  // GET /institutional/dashboard
  async dashboard(req, res, next) {
    try {
      const clubs = await InstitutionalCoordinator.getAllClubsOverview();

      let totalEventsAcrossClubs = 0;
      let totalMembersAcrossClubs = 0;
      let totalCoordinators = 0;

      for (const c of clubs) {
        totalEventsAcrossClubs += Number(c.total_events || 0);
        totalMembersAcrossClubs += Number(c.total_members || 0);
        totalCoordinators += Number(c.student_coordinators_count || 0);
      }

      res.render('institutional/dashboard', {
        admin: req.user,
        clubs,
        totalEventsAcrossClubs,
        totalMembersAcrossClubs,
        totalCoordinators,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/clubs/:clubId (Requirement 2 & 6: Everything of selected club visible)
  async clubDetails(req, res, next) {
    try {
      const club = await InstitutionalCoordinator.getClubCompleteDetails(req.params.clubId);
      if (!club) {
        return res.status(404).render('not-found');
      }

      res.render('institutional/club-details', {
        admin: req.user,
        club,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/events/:eventId (Full event attendance inspection)
  async eventDetails(req, res, next) {
    try {
      const event = await Event.findByIdWithDetails(req.params.eventId);
      if (!event) {
        return res.status(404).render('not-found');
      }

      const attendees = await Event.getAttendeesForEvent(event.id);
      const club = await Club.findById(event.club_id);

      res.render('institutional/event-details', {
        admin: req.user,
        event,
        club,
        attendees,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/reports (Central report hub to generate reports for any club)
  async reportsOverview(req, res, next) {
    try {
      const clubs = await InstitutionalCoordinator.getAllClubsOverview();
      const targetClub = clubs.find(c => c.name.toLowerCase().includes('acm') || c.name.toLowerCase().includes('pasc')) || clubs[0];
      if (targetClub) {
        return res.redirect(`/institutional/clubs/${targetClub.id}/report`);
      }
      res.redirect('/institutional/dashboard');
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/clubs/:clubId/report (Generate signed accredited report for any club)
  async clubReport(req, res, next) {
    try {
      const clubId = req.params.clubId;
      const club = await InstitutionalCoordinator.getClubCompleteDetails(clubId);
      if (!club) {
        return res.status(404).render('not-found');
      }

      const allClubs = await InstitutionalCoordinator.getAllClubs();
      const allEvents = await Event.findAllForFaculty(clubId);

      const timeframe = req.query.timeframe || 'all';
      const eventId = req.query.eventId || null;
      const year = req.query.year || new Date().getFullYear();
      const month = req.query.month || new Date().getMonth() + 1;

      let reportData = await Event.getClubReportByTimeframe(clubId, {
        timeframe,
        eventId,
        year: parseInt(year, 10),
        month: parseInt(month, 10),
      });

      // Fallback if filter yielded 0 events
      if (!reportData || reportData.length === 0) {
        const approvedFallback = allEvents.filter(e => e.approval_status === 'approved');
        reportData = [];
        for (const ev of (approvedFallback.length > 0 ? approvedFallback : allEvents)) {
          const attendees = await Event.getAttendeesForEvent(ev.id);
          reportData.push({
            ...ev,
            attendees,
          });
        }
      }

      // Compute aggregate metrics
      const totalEvents = reportData.length;
      let totalAttendees = 0;
      let totalHoursGranted = 0;
      const uniqueStudentIds = new Set();

      reportData.forEach(ev => {
        const attCount = ev.attendees ? ev.attendees.length : 0;
        totalAttendees += attCount;
        totalHoursGranted += (parseFloat(ev.credit_hours || 0) * attCount);
        if (ev.attendees) {
          ev.attendees.forEach(a => {
            if (a.student_id) uniqueStudentIds.add(a.student_id);
          });
        }
      });

      res.render('institutional/club-report', {
        admin: req.user,
        club,
        allClubs,
        allEvents,
        timeframe,
        eventId,
        year,
        month,
        reportData,
        totalEvents,
        totalAttendees,
        totalHoursGranted,
        uniqueStudentsCount: uniqueStudentIds.size,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/clubs/:clubId/members/:studentId (Inspect specific member contributions in a club)
  async memberContributions(req, res, next) {
    try {
      const { clubId, studentId } = req.params;
      const data = await InstitutionalCoordinator.getMemberClubContributions(clubId, studentId);
      if (!data) {
        return res.status(404).render('not-found');
      }

      res.render('institutional/member-contributions', {
        admin: req.user,
        club: data.club,
        student: data.student,
        attendedEvents: data.attendedEvents,
        volunteerTeams: data.volunteerTeams,
        semesterReports: data.semesterReports,
        totalHours: data.totalHours,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/reports/:reportId (Inspect exact verified semester report submitted by a student)
  async viewSemesterReport(req, res, next) {
    try {
      const SemesterReport = require('../models/SemesterReport');
      const report = await SemesterReport.findById(req.params.reportId);
      if (!report) {
        return res.status(404).render('not-found');
      }

      let parsedData = report.report_data;
      if (typeof parsedData === 'string') {
        try { parsedData = JSON.parse(parsedData); } catch (e) { parsedData = {}; }
      }

      res.render('student/semester-report-view', {
        user: req.user,
        report,
        reportData: parsedData,
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = institutionalController;
