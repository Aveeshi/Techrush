const QRCode = require('qrcode');
const Event = require('../models/Event');
const SubEvent = require('../models/SubEvent');
const EventImage = require('../models/EventImage');
const EventRegistration = require('../models/Eventregistration');
const ClubMember = require('../models/Clubmember');
const Team = require('../models/Team');
const AttendanceLog = require('../models/Attenancelog'); // filename is misspelled in this repo, matching it as-is
const EventHead = require('../models/EventHead');
const { sendRegistrationEmail } = require('../utils/mailer');

// A fresh event starts with zero teams (organizers add their own via
// "+ Add team" on the management page). If an organizer HAS added teams
// by the time a volunteer registers, that volunteer should get to choose
// which one(s) to join — see volunteerTeamsPage/joinTeams below. This
// helper is only the FALLBACK: the one case where the event still has no
// teams at all when a volunteer shows up, a single "default" team named
// after the event is created on the spot (and any already-assigned event
// heads are added to it), purely so there's something to join — not an
// eager step at event-creation time.
async function ensureAtLeastOneTeam(event) {
  const existing = await Team.findByEvent(event.id);
  if (existing.length) return existing;

  const team = await Team.create({ eventId: event.id, name: event.title, description: null, createdBy: null });
  const heads = await EventHead.listFor({ eventId: event.id });
  await Promise.all(heads.map(async (head) => {
    await Team.addMember(team.id, head.student_id);
    await Team.assignHead(team.id, head.student_id, null);
  }));
  return [team];
}

const eventController = {
  // GET /events
  // Public — works for both logged-out visitors and logged-in students.
  // req.user is null for anonymous visitors (see res.locals.user middleware).
  async listEvents(req, res, next) {
    try {
      const studentId = req.user?.type === 'student' ? req.user.id : null;
      const q = req.query.q?.trim() || null;
      const events = await Event.findForFeedWithDetails(studentId, { q });
      const idsWithSubEvents = await SubEvent.findEventIdsWithPublishedSubEvents(events.map((e) => e.id));
      const eventsWithFlags = events.map((event) => ({
        ...event,
        hasSubEvents: idsWithSubEvents.has(event.id),
      }));
      res.render('events', { events: eventsWithFlags, q: q || '' });
    } catch (err) {
      next(err);
    }
  },

  // GET /events/:id
  // Shows full description always. "Volunteer Now" only renders if the
  // logged-in student is a member of the organizing club — checked here,
  // not just hidden in the template, so the page itself decides what's
  // possible rather than the button visibility being purely cosmetic.
  //
  // A flagship that has sub-events under it is volunteer-only at THIS
  // level (see register() below) — attendees register for one of its
  // sub-events instead, each with its own info page/QR/teams.
  async showEvent(req, res, next) {
    try {
      const event = await Event.findByIdWithDetails(req.params.id);
      if (!event) {
        return res.status(404).render('not-found');
      }

      const subEvents = await SubEvent.findPublishedByEvent(event.id);
      const hasSubEvents = subEvents.length > 0;
      const images = await EventImage.findByEvent(event.id);

      let canVolunteer = false;
      let registration = null;
      let qrImage = null;
      let isHead = false;

      if (req.user?.type === 'student') {
        canVolunteer = await ClubMember.canVolunteerForEvent(req.user.id, event.id);
        registration = await EventRegistration.findByEventAndStudent(event.id, req.user.id);
        // QR check-in codes only exist for attendees — volunteers never get
        // one (see EventRegistration.create). The QR image itself is
        // regenerated from the stored token on every view; nothing but the
        // token (registration.qr_code) is persisted.
        if (registration?.registration_type === 'attendee' && registration.qr_code && registration.status !== 'cancelled') {
          qrImage = await QRCode.toDataURL(registration.qr_code);
        }
        // This event's own head (not inherited from anywhere — heading
        // just a sub-event doesn't count here) never registers/volunteers
        // for the flagship itself; they manage it instead. See show.ejs.
        isHead = await EventHead.isEventHead({ eventId: event.id }, req.user.id);
      }

      res.render('show', { event, subEvents, hasSubEvents, images, canVolunteer, registration, qrImage, isHead });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:id/register
  // registrationType comes from which button the student clicked
  // ('attendee' or 'volunteer'); volunteer is re-validated server-side
  // inside EventRegistration.create() regardless of what the form claims.
  // EventRegistration.create() generates the qr_code token itself — the
  // redirect below lands back on showEvent(), which renders it as an image.
  //
  // A flagship with sub-events under it never takes attendee registrations
  // at this level (attendees register per sub-event instead) — enforced
  // here, not just by hiding the button, same pattern as the volunteer gate.
  async register(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const { registrationType } = req.body;
      const subEvents = await SubEvent.findPublishedByEvent(req.params.id);
      const hasSubEvents = subEvents.length > 0;

      // Server-side enforcement of the same rule show.ejs hides the
      // buttons for — never trust that the frontend didn't render them
      // anyway. This event's own head manages it, they don't register.
      const isHead = await EventHead.isEventHead({ eventId: req.params.id }, req.user.id);
      if (isHead) {
        return res.status(403).render('show', {
          event: await Event.findByIdWithDetails(req.params.id),
          subEvents, hasSubEvents, isHead,
          canVolunteer: await ClubMember.canVolunteerForEvent(req.user.id, req.params.id),
          registration: null,
          qrImage: null,
          error: 'You\'re the event head — manage this event instead of registering for it.',
        });
      }

      if (!['attendee', 'volunteer'].includes(registrationType) || (hasSubEvents && registrationType === 'attendee')) {
        return res.status(400).render('show', {
          event: await Event.findByIdWithDetails(req.params.id),
          subEvents, hasSubEvents, isHead,
          canVolunteer: await ClubMember.canVolunteerForEvent(req.user.id, req.params.id),
          registration: null,
          qrImage: null,
          error: hasSubEvents
            ? 'This event has sub-events — register for one of them as an attendee, or volunteer here.'
            : 'Invalid registration type',
        });
      }

      const event = await Event.findByIdWithDetails(req.params.id);
      const registration = await EventRegistration.create({
        eventId: req.params.id,
        studentId: req.user.id,
        registrationType,
      });

      // Best-effort confirmation email — never blocks the registration
      // itself. Only attendees get a QR attached (see EventRegistration.
      // create: volunteers never get a qr_code at all).
      const qrDataUrl = registrationType === 'attendee' && registration.qr_code
        ? await QRCode.toDataURL(registration.qr_code)
        : null;
      sendRegistrationEmail({
        to: req.user.email,
        studentName: req.user.name,
        title: event.title,
        startTime: event.start_time,
        venue: event.venue,
        registrationType,
        qrDataUrl,
      }).catch((err) => console.error('Registration email failed:', err.message));

      // Attendees land back on the event page to see their QR. Volunteers
      // have no QR to see — send them to pick which of the event's teams
      // they want to join (self-healing: creates a single fallback team
      // if the organizer hasn't added any yet — see ensureAtLeastOneTeam).
      if (registrationType === 'volunteer') {
        return res.redirect(`/events/${req.params.id}/volunteer-teams`);
      }
      res.redirect(`/events/${req.params.id}`);
    } catch (err) {
      // Two expected failure modes worth showing back to the user instead
      // of a generic 500: already registered (UNIQUE violation) or tried
      // to volunteer without club membership (thrown in the model).
      const event = await Event.findByIdWithDetails(req.params.id);
      const subEvents = await SubEvent.findPublishedByEvent(req.params.id);
      const hasSubEvents = subEvents.length > 0;
      const canVolunteer = req.user
        ? await ClubMember.canVolunteerForEvent(req.user.id, req.params.id)
        : false;

      if (err.code === '23505') { // Postgres unique_violation
        return res.status(409).render('show', {
          event, subEvents, hasSubEvents, canVolunteer, registration: null, qrImage: null,
          error: 'You are already registered for this event',
        });
      }
      if (err.message.includes('must be a member')) {
        return res.status(403).render('show', {
          event, subEvents, hasSubEvents, canVolunteer, registration: null, qrImage: null,
          error: err.message,
        });
      }
      next(err);
    }
  },

  // GET /events/:id/volunteer-teams
  // The team picker a volunteer lands on right after registering (and can
  // return to any time to change their mind). Shows every team for this
  // event with a checkbox, pre-checked for teams they've already joined.
  // No approval step — joining/leaving is instant on submit. If the
  // organizer hasn't added any teams yet, ensureAtLeastOneTeam creates the
  // single fallback "default" team (named after the event) right here.
  async volunteerTeamsPage(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const event = await Event.findByIdWithDetails(req.params.id);
      if (!event) {
        return res.status(404).render('not-found');
      }

      const canVolunteer = await ClubMember.canVolunteerForEvent(req.user.id, event.id);
      if (!canVolunteer) {
        return res.status(403).send('You must be a member of the organizing club to volunteer for this event');
      }

      const allTeams = await ensureAtLeastOneTeam(event);
      const myTeams = await Team.findByStudentAndEvent(event.id, req.user.id);
      const myTeamIds = new Set(myTeams.map((t) => t.id));

      res.render('volunteer-teams', {
        event,
        teams: allTeams.map((t) => ({ ...t, joined: myTeamIds.has(t.id) })),
        backUrl: `/events/${event.id}`,
        formAction: `/events/${event.id}/volunteer-teams`,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:id/volunteer-teams
  // Body: teamIds — the checked boxes. Diffs against current membership:
  // newly checked teams get joined, newly unchecked ones get left. Every
  // id is verified to actually belong to this event before use, so a
  // tampered request can't join a team on a different event.
  async joinTeams(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const eventId = req.params.id;
      const canVolunteer = await ClubMember.canVolunteerForEvent(req.user.id, eventId);
      if (!canVolunteer) {
        return res.status(403).send('You must be a member of the organizing club to volunteer for this event');
      }

      // Registering as a volunteer (idempotent — a repeat visit to this
      // page for an already-registered volunteer just skips the insert).
      const existingRegistration = await EventRegistration.findByEventAndStudent(eventId, req.user.id);
      if (!existingRegistration) {
        await EventRegistration.create({ eventId, studentId: req.user.id, registrationType: 'volunteer' });
      }

      const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
      const selectedIds = new Set(toArray(req.body.teamIds));

      const eventTeams = await Team.findByEvent(eventId);
      const eventTeamIds = new Set(eventTeams.map((t) => t.id));
      const myTeams = await Team.findByStudentAndEvent(eventId, req.user.id);
      const myTeamIds = new Set(myTeams.map((t) => t.id));

      await Promise.all(eventTeams.map(async (team) => {
        const isSelected = selectedIds.has(team.id) && eventTeamIds.has(team.id);
        const isMember = myTeamIds.has(team.id);
        if (isSelected && !isMember) {
          await Team.addMember(team.id, req.user.id);
        } else if (!isSelected && isMember) {
          await Team.removeMember(team.id, req.user.id);
        }
      }));

      res.redirect(`/teams/event/${eventId}`);
    } catch (err) {
      next(err);
    }
  },

  // GET /events/:id/scan
  // Organizer-only. requireOrganizer (router-level) already guarantees
  // req.user.type === 'organizer'; this additionally checks the organizer
  // belongs to the club that owns THIS event — an organizer from Club A
  // shouldn't be able to scan attendees into Club B's event just because
  // they're logged in.
  async scanPage(req, res, next) {
    try {
      const event = req.eventContainer.row;
      res.render('scan', { event });
    } catch (err) {
      next(err);
    }
  },

  // POST /events/:id/checkin
  // Body: { qrCode } — the raw text the browser's camera just decoded.
  // Returns JSON (not a redirect/render) because this is called via fetch()
  // from the scan page's JS after every successful camera decode.
  async checkin(req, res, next) {
    try {
      const event = req.eventContainer.row;

      const { qrCode } = req.body;
      if (!qrCode) {
        return res.status(400).json({ error: 'Missing qrCode' });
      }

      const { action, registration } = await AttendanceLog.scanQrCode(qrCode, { eventId: event.id }, req.user.id);

      // A check-in is also the moment an attendee's credit_hours (if the
      // organizer set any — see Event.js's schema note) become real, so
      // push the same live-update signal teamController.completeTask sends
      // on task verification — /account's "My Hours" table re-fetches and
      // prepends without a reload. Cheap to fire even when this event has
      // no credit_hours configured; getHoursBreakdown just won't have a
      // new row for it, so the client-side dedupe is a no-op.
      if (action === 'check_in' && registration.registration_type === 'attendee') {
        req.app.get('io').to(`user:${registration.student_id}`).emit('hours:updated');
      }

      res.json({
        success: true,
        action, // 'check_in' | 'check_out'
        student: { name: registration.name, email: registration.email },
        registrationType: registration.registration_type,
      });
    } catch (err) {
      // Expected failure modes from AttendanceLog.scanQrCode — surfaced as
      // 4xx JSON so the scan page can show a red banner instead of a crash.
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

module.exports = eventController;