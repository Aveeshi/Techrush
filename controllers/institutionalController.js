const InstitutionalCoordinator = require('../models/InstitutionalCoordinator');
const Event = require('../models/Event');
const Club = require('../models/Club');

const institutionalController = {
  // GET /institutional/dashboard
  async dashboard(req, res, next) {
    try {
      const clubs = await InstitutionalCoordinator.getAllClubsOverview();

      let totalEventsAcrossClubs = 0;
      let totalMembersAcrossClubs = 0;
      let totalCoordinators = 0;

      for (const c of clubs) {
        totalEventsAcrossClubs += Number(c.total_events || 0);
        totalMembersAcrossClubs += Number(c.total_members || 0);
        totalCoordinators += Number(c.student_coordinators_count || 0);
      }

      res.render('institutional/dashboard', {
        admin: req.user,
        clubs,
        totalEventsAcrossClubs,
        totalMembersAcrossClubs,
        totalCoordinators,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/clubs/:clubId (Requirement 2 & 6: Everything of selected club visible)
  async clubDetails(req, res, next) {
    try {
      const club = await InstitutionalCoordinator.getClubCompleteDetails(req.params.clubId);
      if (!club) {
        return res.status(404).render('not-found');
      }

      res.render('institutional/club-details', {
        admin: req.user,
        club,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /institutional/events/:eventId (Full event attendance inspection)
  async eventDetails(req, res, next) {
    try {
      const event = await Event.findByIdWithDetails(req.params.eventId);
      if (!event) {
        return res.status(404).render('not-found');
      }

      const attendees = await Event.getAttendeesForEvent(event.id);
      const club = await Club.findById(event.club_id);

      res.render('institutional/event-details', {
        admin: req.user,
        event,
        club,
        attendees,
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = institutionalController;
