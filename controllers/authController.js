const passport = require('passport');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Organizer = require('../models/Organizer');
const ClubMember = require('../models/Clubmember');
const ClubRoster = require('../models/ClubRoster');
const SkillTag = require('../models/Skilltag');
const EventType = require('../models/Eventtype');
const EventHead = require('../models/EventHead');
const Team = require('../models/Team');

const COOKIE_OPTIONS = {
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

/*
  These two cookies are UX conveniences only — they let the frontend
  render "logged in as X" without an API round-trip on every page load.
  They are NOT the auth mechanism. req.isAuthenticated() / req.user via
  the passport session cookie (e.g. connect.sid) is the real check on
  every protected route. Never trust the `user` cookie's contents for
  authorization decisions — always re-derive from req.user server-side.
*/
function setAuthCookies(res, user, type) {
  res.cookie('isLoggedIn', 'true', COOKIE_OPTIONS);
  res.cookie('user', JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
    type,
  }), COOKIE_OPTIONS);
}

function clearAuthCookies(res) {
  res.clearCookie('isLoggedIn');
  res.clearCookie('user');
}

// Shared helper for the signup form's picker fields — every render of the
// signup page needs these lists regardless of whether it's a fresh GET or
// a re-render after a validation error, so pulling this into one place
// avoids fetching it three different ways. `openSlots` (via
// Organizer.findOpenSlots) is what drives the organizer panel's club+role
// picker — clubs with both President and VP already taken simply don't
// appear. Students no longer pick clubs at all (see ClubRoster.js) so
// there's no student-facing club list here anymore.
async function getSignupPickerData() {
  const [openSlots, skillTags, eventTypes] = await Promise.all([
    Organizer.findOpenSlots(),
    SkillTag.findAll(),
    EventType.findAll(),
  ]);
  return { openSlots, skillTags, eventTypes };
}

const authController = {
  // GET /signup
  async signupPage(req, res, next) {
    try {
      const pickerData = await getSignupPickerData();
      res.render('auth/signup', { title: 'Sign Up', errors: [], oldInput: {}, ...pickerData });
    } catch (err) {
      next(err);
    }
  },

  // POST /auth/signup
  // ONE form, ONE endpoint — branches on typeOfUser rather than being two
  // separate routes, since your signup.ejs is a single form with a
  // student/organizer toggle, not two different pages. Validators are run
  // manually here (not as router middleware) because which rules apply
  // depends on typeOfUser, which is only known once the body arrives.
  async signup(req, res, next) {
    const { typeOfUser } = req.body;

    if (typeOfUser === 'organizer') {
      return authController._organizerSignup(req, res, next);
    }
    return authController._studentSignup(req, res, next);
  },

  async _studentSignup(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const pickerData = await getSignupPickerData();
      return res.status(422).render('auth/signup', {
        title: 'Sign Up',
        errors: errors.array().map((e) => e.msg),
        oldInput: req.body,
        ...pickerData,
      });
    }

    try {
      const {
        name, email, password, rollNumber, department, year, phone,
        skillTagIds, eventTypeInterestIds,
      } = req.body;

      const existing = await User.findByEmail(email);
      if (existing) {
        const pickerData = await getSignupPickerData();
        return res.status(409).render('auth/signup', {
          title: 'Sign Up',
          errors: ['An account with this email already exists'],
          oldInput: req.body,
          ...pickerData,
        });
      }

      const student = await User.create({
        name, email, password, rollNumber, department, year, phone,
        profilePhotoUrl: req.file?.path,
      });

      // No club checkboxes anymore — club membership is verified against
      // whatever an organizer uploaded for their club's roster (see
      // ClubRoster.js), matched by email, not self-declared here.
      const rosterClubIds = await ClubRoster.findClubIdsForEmail(student.email);
      if (rosterClubIds.length) {
        await Promise.all(rosterClubIds.map((clubId) => ClubMember.join(clubId, student.id)));
      }

      // Multi-select fields arrive as either an array (multiple checked)
      // or a single string (exactly one checked) depending on how the
      // browser serializes repeated checkbox names — normalize to an array.
      const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

      const selectedSkills = toArray(skillTagIds);
      const selectedInterests = toArray(eventTypeInterestIds);

      if (selectedSkills.length) {
        await SkillTag.setStudentSkills(student.id, selectedSkills);
      }
      if (selectedInterests.length) {
        await SkillTag.setStudentEventInterests(student.id, selectedInterests);
      }

      req.login({ ...student, type: 'student' }, (err) => {
        if (err) return next(err);
        setAuthCookies(res, student, 'student');
        res.redirect('/events');
      });
    } catch (err) {
      next(err);
    }
  },

  async _organizerSignup(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const pickerData = await getSignupPickerData();
      return res.status(422).render('auth/signup', {
        title: 'Sign Up',
        errors: errors.array().map((e) => e.msg),
        oldInput: req.body,
        ...pickerData,
      });
    }

    try {
      const { name, email, password, clubId, role } = req.body;

      const existing = await Organizer.findByEmail(email);
      if (existing) {
        const pickerData = await getSignupPickerData();
        return res.status(409).render('auth/signup', {
          title: 'Sign Up',
          errors: ['An account with this email already exists'],
          oldInput: req.body,
          ...pickerData,
        });
      }

      // Re-check server-side — never trust that the dropdown's options
      // were still accurate by the time this POST arrived (someone else
      // could've claimed the slot moments earlier).
      if (!['president', 'vice_president'].includes(role) || !(await Organizer.isRoleOpen(clubId, role))) {
        const pickerData = await getSignupPickerData();
        return res.status(409).render('auth/signup', {
          title: 'Sign Up',
          errors: ['That club/role is no longer available — someone may have just claimed it.'],
          oldInput: req.body,
          ...pickerData,
        });
      }

      const organizer = await Organizer.create({ name, email, password, clubId, role });

      req.login({ ...organizer, type: 'organizer' }, (err) => {
        if (err) return next(err);
        setAuthCookies(res, organizer, 'organizer');
        res.redirect('/events');
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /login
  loginPage(req, res) {
    res.render('auth/login', { title: 'Login', errors: [], oldInput: {} });
  },

  // POST /auth/student/login
  studentLogin(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).render('auth/login', {
        title: 'Login', errors: errors.array().map((e) => e.msg), oldInput: req.body,
      });
    }
    passport.authenticate('student-local', (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).render('auth/login', {
          title: 'Login', errors: [info?.message || 'Invalid email or password'], oldInput: req.body,
        });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        setAuthCookies(res, user, 'student');
        res.redirect('/events');
      });
    })(req, res, next);
  },

  // POST /auth/organizer/login
  organizerLogin(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).render('auth/login', {
        title: 'Login', errors: errors.array().map((e) => e.msg), oldInput: req.body,
      });
    }
    passport.authenticate('organizer-local', (err, organizer, info) => {
      if (err) return next(err);
      if (!organizer) {
        return res.status(401).render('auth/login', {
          title: 'Login', errors: [info?.message || 'Invalid email or password'], oldInput: req.body,
        });
      }
      req.login(organizer, (err) => {
        if (err) return next(err);
        setAuthCookies(res, organizer, 'organizer');
        res.redirect('/events');
      });
    })(req, res, next);
  },

  // GET /auth/google/callback
  googleCallback(req, res) {
    if (req.user.pending) {
      return res.redirect('/auth/choose-role');
    }
    setAuthCookies(res, req.user, req.user.type);
    res.redirect('/events');
  },

  // GET /auth/choose-role
  // Only reachable mid-way through a Google signup — req.user.pending is
  // true only in that state (see passport.js). Anyone else gets bounced.
  async chooseRolePage(req, res) {
    if (!req.user?.pending) {
      return res.redirect('/auth/login');
    }
    const pickerData = await getSignupPickerData();
    res.render('choose-role', {
      title: 'Complete your profile',
      pendingUser: req.user,
      errors: [],
      oldInput: {},
      ...pickerData,
    });
  },

  // POST /auth/choose-role/student
  async chooseRoleStudent(req, res, next) {
    if (!req.user?.pending) {
      return res.redirect('/auth/login');
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const pickerData = await getSignupPickerData();
      return res.status(422).render('choose-role', {
        title: 'Complete your profile',
        pendingUser: req.user,
        errors: errors.array().map((e) => e.msg),
        oldInput: req.body,
        ...pickerData,
      });
    }

    try {
      const { rollNumber, department, year, phone, skillTagIds, eventTypeInterestIds } = req.body;

      const student = await User.createFromGoogle({
        name: req.user.name,
        email: req.user.email,
        googleId: req.user.googleId,
        rollNumber,
        department,
        year,
        phone,
        profilePhotoUrl: req.file?.path,
      });

      // Same roster-verified auto-join as the plain signup path — see
      // authController._studentSignup.
      const rosterClubIds = await ClubRoster.findClubIdsForEmail(student.email);
      if (rosterClubIds.length) {
        await Promise.all(rosterClubIds.map((clubId) => ClubMember.join(clubId, student.id)));
      }

      const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
      const selectedSkills = toArray(skillTagIds);
      const selectedInterests = toArray(eventTypeInterestIds);

      if (selectedSkills.length) {
        await SkillTag.setStudentSkills(student.id, selectedSkills);
      }
      if (selectedInterests.length) {
        await SkillTag.setStudentEventInterests(student.id, selectedInterests);
      }

      req.login({ ...student, type: 'student' }, (err) => {
        if (err) return next(err);
        setAuthCookies(res, student, 'student');
        res.redirect('/events');
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /auth/choose-role/organizer
  async chooseRoleOrganizer(req, res, next) {
    if (!req.user?.pending) {
      return res.redirect('/auth/login');
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const pickerData = await getSignupPickerData();
      return res.status(422).render('choose-role', {
        title: 'Complete your profile',
        pendingUser: req.user,
        errors: errors.array().map((e) => e.msg),
        oldInput: req.body,
        ...pickerData,
      });
    }

    try {
      const { clubId, role } = req.body;

      if (!['president', 'vice_president'].includes(role) || !(await Organizer.isRoleOpen(clubId, role))) {
        const pickerData = await getSignupPickerData();
        return res.status(409).render('choose-role', {
          title: 'Complete your profile',
          pendingUser: req.user,
          errors: ['That club/role is no longer available — someone may have just claimed it.'],
          oldInput: req.body,
          ...pickerData,
        });
      }

      const organizer = await Organizer.createFromGoogle({
        name: req.user.name,
        email: req.user.email,
        googleId: req.user.googleId,
        clubId,
        role,
      });

      req.login({ ...organizer, type: 'organizer' }, (err) => {
        if (err) return next(err);
        setAuthCookies(res, organizer, 'organizer');
        res.redirect('/events');
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /auth/logout
  logout(req, res, next) {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((err) => {
        if (err) return next(err);
        clearAuthCookies(res);
        res.clearCookie('connect.sid');
        res.redirect('/');
      });
    });
  },

  // GET /auth/me — kept as JSON; useful for any future JS-driven UI
  // (e.g. a "still logged in?" check) without needing a full page render.
  me(req, res) {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    res.json({ user: req.user });
  },

  // GET /auth/me-roles — polled by the nav's client script right after a
  // 'role:updated' socket event, so "Event Head"/"Team Head" chips and the
  // "My Events"/"My Teams" links can appear without a full page reload.
  // Mirrors the same isHeadOfAny lookups the app-level role-flag
  // middleware already runs on every render (see app.js).
  async meRoles(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.json({ isEventHead: false, isTeamHead: false });
      }
      const [isEventHead, isTeamHead] = await Promise.all([
        EventHead.isHeadOfAny(req.user.id),
        Team.isHeadOfAny(req.user.id),
      ]);
      res.json({ isEventHead, isTeamHead });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = authController;