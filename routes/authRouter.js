const express = require('express');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { makeUploader } = require('../utils/cloudinary');
const {
  runSignupValidation,
  studentLoginValidation,
  organizerLoginValidation,
  chooseRoleStudentValidation,
  chooseRoleOrganizerValidation,
} = require('../validators/authValidators');

const authRouter = express.Router();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    if (req.accepts('html')) {
      return res.status(429).send('Too many login attempts. Please try again later.');
    }
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  },
});

// Optional profile-photo upload on signup — a student who skips it gets a
// random default avatar instead (see models/User.js). Organizer signups
// don't have a photo field, but running this on the shared /signup route
// is harmless (req.file is just undefined for that branch).
const profilePhotoUpload = makeUploader('profile-photos').single('profilePhoto');

/*
  Mounted at /auth in app.js — every path below is relative to that, so
  NONE of them repeat the /auth prefix themselves. This is what makes
  MVC-style mounting actually work: app.js owns the namespace, this file
  only owns what comes after it.

    app.use('/auth', authRouter);

  Resulting URLs: /auth/signup, /auth/login, /auth/student/login,
  /auth/google, /auth/choose-role, etc.
*/

// --- Pages ---
authRouter.get('/signup', authController.signupPage);
authRouter.get('/login', authController.loginPage);
authRouter.get('/faculty-login', authController.facultyLoginPage);
authRouter.get('/institutional-login', authController.institutionalLoginPage);

// --- Unified signup (student OR organizer, branches on typeOfUser) ---
authRouter.post('/signup', profilePhotoUpload, runSignupValidation, authController.signup);

// --- Login ---
authRouter.post('/student/login', loginRateLimit, studentLoginValidation, authController.studentLogin);
authRouter.post('/organizer/login', loginRateLimit, organizerLoginValidation, authController.organizerLogin);
authRouter.post('/faculty/login', loginRateLimit, authController.facultyLogin);
authRouter.post('/institutional/login', loginRateLimit, authController.institutionalLogin);

// --- Google OAuth (both types — see passport.js for the pending/choose-role flow) ---
authRouter.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/auth/login?error=Google+login+is+not+configured');
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
authRouter.get(
  '/google/callback',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect('/auth/login?error=Google+login+is+not+configured');
    }
    passport.authenticate('google', { failureRedirect: '/auth/login?error=google', session: true })(req, res, next);
  },
  authController.googleCallback
);

// --- Choose role (Google signups only) ---
authRouter.get('/choose-role', authController.chooseRolePage);
authRouter.post('/choose-role/student', profilePhotoUpload, chooseRoleStudentValidation, authController.chooseRoleStudent);
authRouter.post('/choose-role/organizer', chooseRoleOrganizerValidation, authController.chooseRoleOrganizer);

// --- Shared ---
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authController.me);
authRouter.get('/me-roles', authController.meRoles);

module.exports = authRouter;