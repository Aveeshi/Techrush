const User = require('../models/User');
const Club = require('../models/Club');
const ClubMember = require('../models/Clubmember');
const SemesterReport = require('../models/SemesterReport');
const FacultyCoordinator = require('../models/FacultyCoordinator');

const studentDashboardController = {
  // GET /student/dashboard (or /student/dashboard/:studentId)
  async dashboard(req, res, next) {
    try {
      const studentId = req.targetStudentId || req.user.id;
      const isViewingOwn = req.user.type === 'student' && req.user.id === studentId;

      const student = await User.findById(studentId);
      if (!student) {
        return res.status(404).render('not-found');
      }

      // Priority Club
      const priorityClub = await User.getPriorityClub(studentId);

      // All clubs student is member of (to allow changing priority club)
      const myClubs = await ClubMember.findByStudent(studentId);

      // All attended events (non-editable verified log: event name, date, hours, venue, club)
      const attendedEvents = await User.getAttendedEventsWithDetails(studentId);

      // Credited hours totals
      const totalHoursAll = await User.getCreditedHours(studentId);
      const priorityClubHours = priorityClub
        ? await User.getPriorityClubHours(studentId, priorityClub.id)
        : 0;

      // Hours breakdown by club
      const hoursByClub = await User.getCreditedHoursByClub(studentId);

      // Student coordinatorships
      const coordinatorships = await FacultyCoordinator.isStudentCoordinator(studentId);

      // Recent semester reports
      const semesterReports = await SemesterReport.findByStudent(studentId);

      res.render('student/dashboard', {
        student,
        isViewingOwn,
        isInspector: !isViewingOwn,
        inspectorType: req.user.type,
        priorityClub,
        myClubs,
        attendedEvents,
        totalHoursAll,
        priorityClubHours,
        hoursByClub,
        coordinatorships,
        semesterReports,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /student/priority-club
  async setPriorityClub(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.status(403).json({ error: 'Student only' });
      }
      const { clubId } = req.body;
      if (!clubId) {
        return res.redirect('/student/dashboard');
      }

      // Verify membership
      const isMember = await ClubMember.isMember(clubId, req.user.id);
      if (!isMember) {
        return res.redirect('/student/dashboard?error=not_a_member');
      }

      await User.setPriorityClub(req.user.id, clubId);
      res.redirect('/student/dashboard?updated_priority=1');
    } catch (err) {
      next(err);
    }
  },

  // GET /student/semester-report
  async semesterReportPage(req, res, next) {
    try {
      const studentId = req.targetStudentId || req.user.id;
      const student = await User.findById(studentId);
      const priorityClub = await User.getPriorityClub(studentId);
      const myClubs = await ClubMember.findByStudent(studentId);
      const attendedEvents = await User.getAttendedEventsWithDetails(studentId);
      const reports = await SemesterReport.findByStudent(studentId);

      res.render('student/semester-report', {
        student,
        priorityClub,
        myClubs,
        attendedEvents,
        reports,
        submitted: req.query.submitted === '1',
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /student/semester-report/submit
  async submitSemesterReport(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.status(403).json({ error: 'Student only' });
      }

      const { clubId, academicYear, semester } = req.body;
      if (!clubId || !academicYear || !semester) {
        return res.redirect('/student/semester-report?error=missing_fields');
      }

      // Pull verified events under this club
      const allAttended = await User.getAttendedEventsWithDetails(req.user.id);
      const clubEvents = allAttended.filter(e => e.club_id === clubId);

      let totalHours = 0;
      clubEvents.forEach(e => {
        totalHours += Number(e.credit_hours) || 0;
      });

      const reportSnapshot = {
        studentName: req.user.name,
        rollNumber: req.user.roll_number,
        department: req.user.department,
        year: req.user.year,
        academicYear,
        semester: Number(semester),
        totalHours,
        events: clubEvents.map(e => ({
          title: e.title,
          date: e.event_date,
          venue: e.venue,
          creditHours: e.credit_hours,
          checkedInAt: e.checked_in_at,
        })),
      };

      await SemesterReport.submitOrUpdate({
        studentId: req.user.id,
        clubId,
        academicYear,
        semester: Number(semester),
        totalHours,
        reportData: reportSnapshot,
      });

      res.redirect('/student/semester-report?submitted=1');
    } catch (err) {
      next(err);
    }
  },

  // GET /student/semester-report/:reportId/view
  async viewSemesterReport(req, res, next) {
    try {
      const report = await SemesterReport.findById(req.params.reportId);
      if (!report) {
        return res.status(404).render('not-found');
      }

      // Check access permission (own report, FC of club, Student Coordinator, or Institutional Coordinator)
      const isOwn = req.user?.id === report.student_id;
      const isFC = req.user?.type === 'faculty' && req.user.club_id === report.club_id;
      const isInst = req.user?.type === 'institutional';
      let isSC = false;
      if (req.user?.type === 'student') {
        const scList = await FacultyCoordinator.isStudentCoordinator(req.user.id, report.club_id);
        isSC = scList.some(s => s.can_inspect_records);
      }

      if (!isOwn && !isFC && !isInst && !isSC) {
        return res.status(403).render('error', { message: 'Unauthorized to view this report.' });
      }

      res.render('student/semester-report-view', {
        report,
        isOwn,
        isFC,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /student/graduation-report (Requirement 5: 4-Year Cumulative Dossier)
  async graduationReport(req, res, next) {
    try {
      const studentId = req.targetStudentId || req.user.id;
      const summary = await SemesterReport.getCumulativeGraduationSummary(studentId);
      if (!summary) {
        return res.status(404).render('not-found');
      }

      res.render('student/graduation-report', {
        summary,
        generatedAt: new Date(),
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /student/yearly-summary (Requirement 5: Yearly Memory Summary)
  async yearlySummary(req, res, next) {
    try {
      const studentId = req.targetStudentId || req.user.id;
      const academicYear = req.query.year || null;
      const summary = await SemesterReport.getYearlyMemorySummary(studentId, academicYear);
      if (!summary) {
        return res.status(404).render('not-found');
      }

      res.render('student/yearly-summary', {
        summary,
        selectedYear: academicYear,
        generatedAt: new Date(),
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = studentDashboardController;
