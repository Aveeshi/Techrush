const express = require('express');
const multer = require('multer');
const organizerController = require('../controllers/organizerController');

const organizerRouter = express.Router();

/*
  Mounted at /club in app.js. Memory storage (not disk/Cloudinary) — the
  uploaded roster workbook is only ever read once (XLSX.read on the
  buffer) and never needs to persist as a file; only the parsed rows get
  written anywhere (club_rosters).
*/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

organizerRouter.get('/', organizerController.clubPage);
organizerRouter.post('/roster', upload.single('roster'), organizerController.uploadRoster);

module.exports = organizerRouter;
