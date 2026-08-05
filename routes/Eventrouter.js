const express = require('express');
const eventController = require('../controllers/eventController');
const { requireOrganizer } = require('../middleware/auth');

const eventRouter = express.Router();

eventRouter.get('/', eventController.listEvents);
eventRouter.get('/:id', eventController.showEvent);
eventRouter.post('/:id/register', eventController.register);

// Host-side QR check-in/check-out — organizer-only (scanPage/checkin do a
// further club_id ownership check on top of this).
eventRouter.get('/:id/scan', requireOrganizer, eventController.scanPage);
eventRouter.post('/:id/checkin', requireOrganizer, eventController.checkin);

module.exports = eventRouter;