const EventType = require('../models/Eventtype');

const eventTypeController = {
  // GET /event-types
  // Public — no auth required. Powers the "what events do you want to
  // attend" multi-select on signup (student_event_interests), and
  // separately backs the category dropdown when an organizer creates
  // an event (Hackathon, Meetup, etc.).
  async listEventTypes(req, res, next) {
    try {
      const eventTypes = await EventType.findAll();
      res.json({ eventTypes });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = eventTypeController;