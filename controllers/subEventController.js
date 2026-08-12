const QRCode = require('qrcode');
const SubEvent = require('../models/SubEvent');
const EventRegistration = require('../models/Eventregistration');
const ClubMember = require('../models/Clubmember');
const Team = require('../models/Team');
const AttendanceLog = require('../models/Attenancelog');
const EventHead = require('../models/EventHead');
const SkillTag = require('../models/Skilltag');
const { sendRegistrationEmail } = require('../utils/mailer');

// A draft sub-event is visible to its own managers (the owning club's
// organizer, this sub-event's own event head, OR — hierarchically — the
// head of its parent flagship event) but 404s for everyone else — same
// "drafts are invisible to the public" rule flagship events already get
// from Event.findForFeedWithDetails's status filter.
async function canSeeUnpublished(subEvent, user) {
  if (!user) return false;
  if (user.type === 'organizer') return user.club_id === subEvent.club_id;
  if (user.type === 'student') return EventHead.isEventHeadOfSubEvent(subEvent, user.id);
  return false;
}

// A fresh sub-event starts with zero teams too (organizers add their own
// via "+ Add team"). Mirrors eventController.js's ensureAtLeastOneTeam —
// only creates the single fallback "default" team, named after the
// sub-event, the first time a volunteer shows up to a sub-event that
// still has none.
async function ensureAtLeastOneTeam(subEvent) {
  const existing = await Team.findBySubEvent(subEvent.id);
  if (existing.length) return existing;

  const team = await Team.create({ subEventId: subEvent.id, name: subEvent.title, description: null, createdBy: null });
  const heads = await EventHead.listFor({ subEventId: subEvent.id });
  await Promise.all(heads.map(async (head) => {
    await Team.addMember(team.id, head.student_id);
    await Team.assignHead(team.id, head.student_id, null);
  }));
  return [team];
}

/*
  Student-facing side of a sub-event — mirrors eventController.js one-for-one
  (showEvent/register/volunteerTeamsPage/joinTeams/scanPage/checkin), just
  scoped to sub_events instead of events. A sub-event has its own
  registrations (own QR for attendees), its own teams (no auto-provisioned
  standard teams — see SubEvent.create), and its own scan page. The one
  thing it does NOT have is a "does this have sub-events" branch — a
  sub-event never nests further sub-events.
*/

const subEventController = {
  // GET /events/:eventId/sub-events/:subEventId
  async showSubEvent(req, res, next) {
    try {
      const subEvent = await SubEvent.findByIdWithDetails(req.params.subEventId);
      if (!subEvent || subEvent.event_id !== req.params.eventId) {
        return res.status(404).render('not-found');
      }
      if (subEvent.status !== 'published' && !(await canSeeUnpublished(subEvent, req.user))) {
        return res.status(404).render('not-found');
      }

      let canVolunteer = false;
      let registration = null;
      let qrImage = null;
      let isHead = false;

      if (req.user?.type === 'student') {
        canVolunteer = await ClubMember.canVolunteerForSubEvent(req.user.id, subEvent.id);
        registration = await EventRegistration.findBySubEventAndStudent(subEvent.id, req.user.id);
        if (registration?.registration_type === 'attendee' && registration.qr_code && registration.status !== 'cancelled') {
          qrImage = await QRCode.toDataURL(registration.qr_code);
        }
        // Hierarchical: this specific sub-event's own head, OR the head
        // of its parent flagship (who inherits every sub-event head
        // authority) — either way they manage it, not register for it.
        // A sibling sub-event's head, or the flagship's own head for a
        // DIFFERENT flagship, doesn't block this one.
        isHead = await EventHead.isEventHeadOfSubEvent(subEvent, req.user.id);
      }

      res.render('sub-event-show', { subEvent, canVolunteer, registration, qrImage, isHead });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:eventId/sub-events/:subEventId/register
  async register(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const subEvent = await SubEvent.findByIdWithDetails(req.params.subEventId);
      if (!subEvent || subEvent.event_id !== req.params.eventId) {
        return res.status(404).render('not-found');
      }

      // Server-side enforcement of the same rule sub-event-show.ejs hides
      // the buttons for — never trust that the frontend didn't render
      // them anyway.
      const isHead = await EventHead.isEventHeadOfSubEvent(subEvent, req.user.id);
      if (isHead) {
        return res.status(403).render('sub-event-show', {
          subEvent, isHead,
          canVolunteer: await ClubMember.canVolunteerForSubEvent(req.user.id, subEvent.id),
          registration: null,
          qrImage: null,
          error: 'You\'re this sub-event\'s head — manage it instead of registering for it.',
        });
      }

      const { registrationType } = req.body;
      if (!['attendee', 'volunteer'].includes(registrationType)) {
        return res.status(400).render('sub-event-show', {
          subEvent, isHead,
          canVolunteer: await ClubMember.canVolunteerForSubEvent(req.user.id, subEvent.id),
          registration: null,
          qrImage: null,
          error: 'Invalid registration type',
        });
      }

      const registration = await EventRegistration.create({
        subEventId: subEvent.id,
        studentId: req.user.id,
        registrationType,
      });

      const qrDataUrl = registrationType === 'attendee' && registration.qr_code
        ? await QRCode.toDataURL(registration.qr_code)
        : null;
      sendRegistrationEmail({
        to: req.user.email,
        studentName: req.user.name,
        title: subEvent.title,
        startTime: subEvent.start_time,
        venue: subEvent.venue,
        registrationType,
        qrDataUrl,
      }).catch((err) => console.error('Registration email failed:', err.message));

      if (registrationType === 'volunteer') {
        return res.redirect(`/events/${req.params.eventId}/sub-events/${subEvent.id}/volunteer-teams`);
      }
      res.redirect(`/events/${req.params.eventId}/sub-events/${subEvent.id}`);
    } catch (err) {
      const subEvent = await SubEvent.findByIdWithDetails(req.params.subEventId);
      const canVolunteer = req.user
        ? await ClubMember.canVolunteerForSubEvent(req.user.id, req.params.subEventId)
        : false;

      if (err.code === '23505') {
        return res.status(409).render('sub-event-show', {
          subEvent, canVolunteer, registration: null, qrImage: null,
          error: 'You are already registered for this sub-event',
        });
      }
      if (err.message.includes('must be a member')) {
        return res.status(403).render('sub-event-show', {
          subEvent, canVolunteer, registration: null, qrImage: null,
          error: err.message,
        });
      }
      next(err);
    }
  },

  // GET /events/:eventId/sub-events/:subEventId/volunteer-teams
  async volunteerTeamsPage(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const subEvent = await SubEvent.findByIdWithDetails(req.params.subEventId);
      if (!subEvent || subEvent.event_id !== req.params.eventId) {
        return res.status(404).render('not-found');
      }

      const canVolunteer = await ClubMember.canVolunteerForSubEvent(req.user.id, subEvent.id);
      if (!canVolunteer) {
        return res.status(403).send('You must be a member of the organizing club to volunteer for this sub-event');
      }

      const allTeams = await ensureAtLeastOneTeam(subEvent);
      const myTeams = await Team.findByStudentAndSubEvent(subEvent.id, req.user.id);
      const myTeamIds = new Set(myTeams.map((t) => t.id));
      const requiredSkillsByTeam = await SkillTag.getRequiredSkillsForTeams(allTeams.map((t) => t.id));

      res.render('volunteer-teams', {
        event: subEvent,
        teams: allTeams.map((t) => ({
          ...t,
          joined: myTeamIds.has(t.id),
          requiredSkills: requiredSkillsByTeam[t.id] || [],
        })),
        backUrl: `/events/${req.params.eventId}/sub-events/${subEvent.id}`,
        formAction: `/events/${req.params.eventId}/sub-events/${subEvent.id}/volunteer-teams`,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:eventId/sub-events/:subEventId/volunteer-teams
  async joinTeams(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const subEventId = req.params.subEventId;
      const canVolunteer = await ClubMember.canVolunteerForSubEvent(req.user.id, subEventId);
      if (!canVolunteer) {
        return res.status(403).send('You must be a member of the organizing club to volunteer for this sub-event');
      }

      const existingRegistration = await EventRegistration.findBySubEventAndStudent(subEventId, req.user.id);
      if (!existingRegistration) {
        await EventRegistration.create({ subEventId, studentId: req.user.id, registrationType: 'volunteer' });
      }

      const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
      const selectedIds = new Set(toArray(req.body.teamIds));

      const subEventTeams = await Team.findBySubEvent(subEventId);
      const subEventTeamIds = new Set(subEventTeams.map((t) => t.id));
      const myTeams = await Team.findByStudentAndSubEvent(subEventId, req.user.id);
      const myTeamIds = new Set(myTeams.map((t) => t.id));

      await Promise.all(subEventTeams.map(async (team) => {
        const isSelected = selectedIds.has(team.id) && subEventTeamIds.has(team.id);
        const isMember = myTeamIds.has(team.id);
        if (isSelected && !isMember) {
          await Team.addMember(team.id, req.user.id);
        } else if (!isSelected && isMember) {
          await Team.removeMember(team.id, req.user.id);
        }
      }));

      res.redirect(`/teams/sub-event/${subEventId}`);
    } catch (err) {
      next(err);
    }
  },

  // GET /events/:eventId/sub-events/:subEventId/scan
  // Gated by requireEventManager (router-level) — the owning club's
  // organizer OR this sub-event's own event head, same authority as
  // organizer-club-events management.
  async scanPage(req, res, next) {
    try {
      const subEvent = req.eventContainer.row;
      res.render('scan', {
        event: subEvent,
        checkinUrl: `/events/${req.params.eventId}/sub-events/${subEvent.id}/checkin`,
        backUrl: `/events/${req.params.eventId}/sub-events/${subEvent.id}`,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:eventId/sub-events/:subEventId/checkin
  async checkin(req, res, next) {
    try {
      const subEvent = req.eventContainer.row;

      const { qrCode } = req.body;
      if (!qrCode) {
        return res.status(400).json({ error: 'Missing qrCode' });
      }

      const { action, registration } = await AttendanceLog.scanQrCode(qrCode, { subEventId: subEvent.id }, req.user.id);

      // Same live "My Hours" nudge as eventController.checkin — see its
      // comment for why this fires unconditionally on any attendee check-in.
      if (action === 'check_in' && registration.registration_type === 'attendee') {
        req.app.get('io').to(`user:${registration.student_id}`).emit('hours:updated');
      }

      res.json({
        success: true,
        action,
        student: { name: registration.name, email: registration.email },
        registrationType: registration.registration_type,
      });
    } catch (err) {
      const knownErrors = {
        QR_NOT_FOUND: [404, 'This QR code isn\'t registered for any event'],
        WRONG_EVENT: [409, 'This QR code belongs to a different event'],
        REGISTRATION_CANCELLED: [409, 'This registration was cancelled'],
      };
      const known = knownErrors[err.message];
      if (known) {
        return res.status(known[0]).json({ error: known[1] });
      }
      next(err);
    }
  },
};

module.exports = subEventController;
