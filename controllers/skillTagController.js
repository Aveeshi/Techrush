const SkillTag = require('../models/SkillTag');

const skillTagController = {
  // GET /skill-tags
  // Public — no auth required. Powers the "what would you volunteer to
  // do" multi-select on signup (student_skills), and separately can back
  // an organizer's "required skills" picker when creating an event.
  async listSkillTags(req, res, next) {
    try {
      const skillTags = await SkillTag.findAll();
      res.json({ skillTags });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = skillTagController;