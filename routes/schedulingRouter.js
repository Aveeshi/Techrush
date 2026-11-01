const express = require('express');
const multer = require('multer');
const schedulingController = require('../controllers/schedulingController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension)) {
      return callback(new Error('Only .csv and .xlsx calendar files are supported.'));
    }
    callback(null, true);
  },
});

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
router.post('/events/:id/delete', schedulingController.deleteManualEvent);
router.post('/imports/:id/delete', schedulingController.deleteImportedScheduleItem);

module.exports = router;
