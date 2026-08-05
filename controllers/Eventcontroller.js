const QRCode = require('qrcode');
const Event = require('../models/Event');
const EventRegistration = require('../models/EventRegistration');
const ClubMember = require('../models/ClubMember');
const AttendanceLog = require('../models/Attenancelog'); // filename is misspelled in this repo, matching it as-is

const eventController = {
  // GET /events
  // Public — works for both logged-out visitors and logged-in students.
  // req.user is null for anonymous visitors (see res.locals.user middleware).
  async listEvents(req, res, next) {
    try {
      const studentId = req.user?.type === 'student' ? req.user.id : null;
      const events = await Event.findForFeedWithDetails(studentId);
      res.render('events', { events });
    } catch (err) {
      next(err);
    }
  },

  // GET /events/:id
  // Shows full description always. "Volunteer Now" only renders if the
  // logged-in student is a member of the organizing club — checked here,
  // not just hidden in the template, so the page itself decides what's
  // possible rather than the button visibility being purely cosmetic.
  async showEvent(req, res, next) {
    try {
      const event = await Event.findByIdWithDetails(req.params.id);
      if (!event) {
        return res.status(404).render('not-found');
      }

      let canVolunteer = false;
      let registration = null;
      let qrImage = null;

      if (req.user?.type === 'student') {
        canVolunteer = await ClubMember.canVolunteerForEvent(req.user.id, event.id);
        registration = await EventRegistration.findByEventAndStudent(event.id, req.user.id);
        // The QR image is regenerated from the stored token on every view —
        // nothing but the token itself (registration.qr_code) is persisted.
        if (registration?.qr_code && registration.status !== 'cancelled') {
          qrImage = await QRCode.toDataURL(registration.qr_code);
        }
      }

      res.render('show', { event, canVolunteer, registration, qrImage });
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
  async register(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const { registrationType } = req.body;
      if (!['attendee', 'volunteer'].includes(registrationType)) {
        return res.status(400).render('show', {
          event: await Event.findByIdWithDetails(req.params.id),
          canVolunteer: await ClubMember.canVolunteerForEvent(req.user.id, req.params.id),
          registration: null,
          qrImage: null,
          error: 'Invalid registration type',
        });
      }

      await EventRegistration.create({
        eventId: req.params.id,
        studentId: req.user.id,
        registrationType,
      });

      res.redirect(`/events/${req.params.id}`);
    } catch (err) {
      // Two expected failure modes worth showing back to the user instead
      // of a generic 500: already registered (UNIQUE violation) or tried
      // to volunteer without club membership (thrown in the model).
      const event = await Event.findByIdWithDetails(req.params.id);
      const canVolunteer = req.user
        ? await ClubMember.canVolunteerForEvent(req.user.id, req.params.id)
        : false;

      if (err.code === '23505') { // Postgres unique_violation
        return res.status(409).render('show', {
          event, canVolunteer, registration: null, qrImage: null,
          error: 'You are already registered for this event',
        });
      }
      if (err.message.includes('must be a member')) {
        return res.status(403).render('show', {
          event, canVolunteer, registration: null, qrImage: null,
          error: err.message,
        });
      }
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
      const event = await Event.findByIdWithDetails(req.params.id);
      if (!event) {
        return res.status(404).render('not-found');
      }
      if (event.club_id !== req.user.club_id) {
        return res.status(403).send('You can only scan attendees for your own club\'s events');
      }
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
      const event = await Event.findByIdWithDetails(req.params.id);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      if (event.club_id !== req.user.club_id) {
        return res.status(403).json({ error: 'Not your event' });
      }

      const { qrCode } = req.body;
      if (!qrCode) {
        return res.status(400).json({ error: 'Missing qrCode' });
      }

      const { action, registration } = await AttendanceLog.scanQrCode(qrCode, event.id, req.user.id);
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