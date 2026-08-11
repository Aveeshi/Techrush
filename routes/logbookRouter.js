const express = require('express');
const logbookController = require('../controllers/logbookController');
const { makeUploader } = require('../utils/cloudinary');
const wrapUpload = require('../middleware/wrapUpload');

/*
  Mounted at /logbook in app.js. Student-only — every controller method
  re-checks req.user.type itself (matching the pattern in studentRouter),
  so there's no separate requireStudent middleware layer here.
*/
const logbookRouter = express.Router();

// Any image format is accepted (allowedFormats left open — phone photos
// are routinely heic/heif, not jpg/png) but Cloudinary force-converts
// everything to jpg on upload, since that's what utils/logbookDocx.js's
// ImageRun embedding relies on. Previously this restricted allowedFormats
// to ['jpg','jpeg','png'], which silently rejected anything else — the
// upload never reached Cloudinary, so no logbook_images row was ever
// created for it. wrapUpload turns a rejected file into a real Error —
// see middleware/wrapUpload.js.
const imageUpload = wrapUpload(makeUploader('logbook-images', { format: 'jpg' }).array('images', 20));

logbookRouter.get('/', logbookController.index);
logbookRouter.post('/images', imageUpload, logbookController.uploadImages);
logbookRouter.post('/images/:id/delete', logbookController.deleteImage);
logbookRouter.get('/generate', logbookController.generate);

module.exports = logbookRouter;
