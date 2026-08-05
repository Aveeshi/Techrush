const express = require('express');
const passport = require('passport');
const authController = require('../controllers/authController');
const {
  runSignupValidation,
  studentLoginValidation,
  organizerLoginValidation,
  chooseRoleStudentValidation,
  chooseRoleOrganizerValidation,
} = require('../validators/authValidators');

const authRouter = express.Router();

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

// --- Unified signup (student OR organizer, branches on typeOfUser) ---
authRouter.post('/signup', runSignupValidation, authController.signup);

// --- Login ---
authRouter.post('/student/login', studentLoginValidation, authController.studentLogin);
authRouter.post('/organizer/login', organizerLoginValidation, authController.organizerLogin);

// --- Google OAuth (both types — see passport.js for the pending/choose-role flow) ---
authRouter.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
authRouter.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login?error=google', session: true }),
  authController.googleCallback
);

// --- Choose role (Google signups only) ---
authRouter.get('/choose-role', authController.chooseRolePage);
authRouter.post('/choose-role/student', chooseRoleStudentValidation, authController.chooseRoleStudent);
authRouter.post('/choose-role/organizer', chooseRoleOrganizerValidation, authController.chooseRoleOrganizer);

// --- Shared ---
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authController.me);

module.exports = authRouter;