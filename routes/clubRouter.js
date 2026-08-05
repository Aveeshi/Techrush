const express = require('express');
const clubController = require('../controllers/clubController');

const clubRouter = express.Router();

clubRouter.get('/', clubController.listClubs);

module.exports = clubRouter;