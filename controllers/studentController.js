const User = require('../models/User');
const EventRegistration = require('../models/EventRegistration');
const ClubMember = require('../models/ClubMember');
const Club = require('../models/Club');

const studentController = {
  // GET /registered-events
  // Events the student registered for as an ATTENDEE (not volunteering —
  // that's the separate "Teams" page). Student-only page.
  async registeredEvents(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const registrations = await EventRegistration.findByStudent(req.user.id, 'attendee');
      res.render('registered-events', { registrations });
    } catch (err) {
      next(err);
    }
  },

  // GET /account
  // Same route for both account types — branches on user.type for what
  // extra data to pull in, same pattern as authController's signup branch.
  async account(req, res, next) {
    try {
      if (!req.user) {
        return res.redirect('/auth/login');
      }

      if (req.user.type === 'student') {
        const [creditedHours, clubs, hoursByClub, hoursBreakdown] = await Promise.all([
          User.getCreditedHours(req.user.id),
          ClubMember.listClubsForStudent(req.user.id),
          User.getCreditedHoursByClub(req.user.id),
          User.getHoursBreakdown(req.user.id),
        ]);
        return res.render('account', {
          creditedHours, clubs, hoursByClub, hoursBreakdown, clubName: null,
        });
      }

      if (req.user.type === 'organizer') {
        const club = await Club.findById(req.user.club_id);
        return res.render('account', {
          creditedHours: null, clubs: [], hoursByClub: [], hoursBreakdown: [],
          clubName: club?.name || 'Unknown club',
        });
      }

      res.render('account', { creditedHours: null, clubs: [], hoursByClub: [], hoursBreakdown: [], clubName: null });
    } catch (err) {
      next(err);
    }
  },

  // GET /account/hours.json — polled by account.ejs's client script right
  // after a 'hours:updated' socket event, so the "My Hours" table can grow
  // a row without a full page reload. Plain JSON, mirrors the same
  // User.getHoursBreakdown call the page itself renders server-side.
  async hoursJson(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.status(401).json({ error: 'Login required' });
      }
      const hoursBreakdown = await User.getHoursBreakdown(req.user.id);
      res.json({ hoursBreakdown });
    } catch (err) {
      next(err);
    }
  },

  // POST /account/photo — student's own upload from the account page,
  // replacing whichever default avatar (or previous upload) they had.
  async updatePhoto(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      if (req.file) {
        await User.updatePhoto(req.user.id, req.file.path);
      }
      res.redirect('/account');
    } catch (err) {
      next(err);
    }
  },

  // POST /account (student branch) — delegated to from
  // routes/studentRouter.js's shared handler, mirroring how the organizer
  // branch delegates to organizerController.updateAccount.
  async updateProfile(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const { name, rollNumber, department, year, phone } = req.body;
      await User.updateProfile(req.user.id, {
        name, rollNumber, department, year: year || null, phone,
      });
      res.redirect('/account');
    } catch (err) {
      next(err);
    }
  },
};

module.exports = studentController;
