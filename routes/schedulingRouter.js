const express = require('express');
const multer = require('multer');
const schedulingController = require('../controllers/schedulingController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

router.use((req, res, next) => {
  if (!req.isAuthenticated() || !['faculty', 'institutional'].includes(req.user.type)) {
    return req.accepts('html')
      ? res.redirect('/auth/faculty-login')
      : res.status(403).json({ error: 'Faculty or institutional account required' });
  }
  next();
});
router.get('/', schedulingController.calendar);
router.post('/timetable/import', upload.single('timetable'), schedulingController.importTimetable);
router.post('/rooms', schedulingController.addRoom);
router.post('/events', schedulingController.addManualEvent);

module.exports = router;
