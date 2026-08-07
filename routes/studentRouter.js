const express = require('express');
const studentController = require('../controllers/studentController');
const organizerController = require('../controllers/organizerController');
const clubEventController = require('../controllers/clubEventController');
const { makeUploader } = require('../utils/cloudinary');

const profilePhotoUpload = makeUploader('profile-photos').single('profilePhoto');

const studentRouter = express.Router();

/*
  Mounted at / in app.js (these are top-level paths, not nested under a
  shared prefix like /events or /teams — matches how the nav bar links
  directly to /registered-events and /account).

  /account is shared between both account types (see studentController.account,
  which branches on req.user.type) — the POST edit here delegates to
  organizerController for organizers; student self-editing wasn't asked for
  in this pass, so there's no student branch to delegate to yet.
*/

studentRouter.get('/registered-events', studentController.registeredEvents);
studentRouter.get('/my-events', clubEventController.myEvents);
// /my-teams merged into /my-events (one combined tab for a student who's
// both an event head and a team head) — kept as a redirect for anyone
// with the old link bookmarked.
studentRouter.get('/my-teams', (req, res) => res.redirect('/my-events'));
studentRouter.get('/account', studentController.account);
studentRouter.get('/account/hours.json', studentController.hoursJson);
studentRouter.post('/account/photo', profilePhotoUpload, studentController.updatePhoto);
studentRouter.post('/account', (req, res, next) => {
  if (req.user?.type === 'organizer') {
    return organizerController.updateAccount(req, res, next);
  }
  if (req.user?.type === 'student') {
    return studentController.updateProfile(req, res, next);
  }
  res.redirect('/account');
});

module.exports = studentRouter;
