const express = require('express');
const skillTagController = require('../controllers/skillTagController');

const skillTagRouter = express.Router();

skillTagRouter.get('/', skillTagController.listSkillTags);

module.exports = skillTagRouter;