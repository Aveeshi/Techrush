const Club = require('../models/Club');
const ClubMember = require('../models/Clubmember');
const LogbookImage = require('../models/LogbookImage');
const LogbookData = require('../models/LogbookData');
const User = require('../models/User');
const { buildLogbookDocx } = require('../utils/logbookDocx');

// Re-checked on every write below, not just when rendering the picker —
// a student could otherwise POST a clubId for a club they're not in, or
// one that never turned the feature on, straight at these routes.
async function assertEligible(studentId, clubId) {
  const club = await Club.findById(clubId);
  if (!club || !club.logbook_enabled) return null;
  const isMember = await ClubMember.isMember(clubId, studentId);
  if (!isMember) return null;
  return club;
}

const logbookController = {
  // GET /logbook — club picker. If ?club=<id> is present and valid, also
  // shows the upload/generate panel for that club.
  async index(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const eligibleClubs = await Club.findLogbookEnabledForStudent(req.user.id);

      let selectedClub = null;
      let images = [];
      if (req.query.club) {
        selectedClub = eligibleClubs.find((c) => c.id === req.query.club) || null;
        if (selectedClub) {
          images = await LogbookImage.findByStudentAndClub(req.user.id, selectedClub.id);
        }
      }

      res.render('logbook', {
        eligibleClubs,
        selectedClub,
        images,
        uploaded: req.query.uploaded === '1',
        removed: req.query.removed === '1',
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /logbook/images — one or more photos, uploaded to Cloudinary by
  // the makeUploader('logbook-images') multer instance already by the
  // time this runs; req.files carries the resulting secure_urls.
  async uploadImages(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const { clubId } = req.body;
      const club = await assertEligible(req.user.id, clubId);
      if (!club) {
        return res.status(403).send('This club is not open for logbook generation, or you are not a member.');
      }

      const files = req.files || [];
      for (const file of files) {
        await LogbookImage.create({ studentId: req.user.id, clubId, url: file.path });
      }

      res.redirect(`/logbook?club=${clubId}&uploaded=1`);
    } catch (err) {
      next(err);
    }
  },

  // POST /logbook/images/:id/delete — remove one of the student's own
  // uploaded photos before generating (LogbookImage.deleteForStudent scopes
  // the delete to req.user.id, so this can't touch anyone else's rows).
  async deleteImage(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const { clubId } = req.body;
      await LogbookImage.deleteForStudent(req.params.id, req.user.id);
      res.redirect(`/logbook?club=${clubId}&removed=1`);
    } catch (err) {
      next(err);
    }
  },

  // GET /logbook/generate?club=<id> — builds the .docx on demand (nothing
  // about the generated document itself is persisted, only the source
  // rows/images it's built from) and streams it back as a download.
  async generate(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const clubId = req.query.club;
      const club = await assertEligible(req.user.id, clubId);
      if (!club) {
        return res.status(403).send('This club is not open for logbook generation, or you are not a member.');
      }

      const [student, taskRows, eventRows, images] = await Promise.all([
        User.findById(req.user.id),
        LogbookData.getVerifiedTaskRows(req.user.id, clubId),
        LogbookData.getAttendedEventRows(req.user.id, clubId),
        LogbookImage.findByStudentAndClub(req.user.id, clubId),
      ]);

      const buffer = await buildLogbookDocx({ student, club, taskRows, eventRows, images });

      const safeName = `${student.name.replace(/[^a-z0-9]+/gi, '_')}_${club.name.replace(/[^a-z0-9]+/gi, '_')}_Logbook.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = logbookController;
