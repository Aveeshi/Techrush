const Club = require('../models/Club');

const clubController = {
  // GET /clubs
  // Public — no auth required. Powers the organizer tab's club picker on
  // the choose-role screen, and can double as a general "browse clubs"
  // list later.
  async listClubs(req, res, next) {
    try {
      const clubs = await Club.findAll();
      res.json({ clubs });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = clubController;