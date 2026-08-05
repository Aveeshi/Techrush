const express = require('express');
const eventTypeController = require('../controllers/eventTypeController');

const eventTypeRouter = express.Router();

eventTypeRouter.get('/', eventTypeController.listEventTypes);

module.exports = eventTypeRouter;