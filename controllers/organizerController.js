const XLSX = require('xlsx');
const Club = require('../models/Club');
const ClubMember = require('../models/ClubMember');
const ClubRoster = require('../models/ClubRoster');
const Organizer = require('../models/Organizer');

// Pulls {name, email} pairs out of an uploaded workbook's first sheet.
// Header matching is case-insensitive and tolerant of a couple common
// variants ("Full Name" / "Email Address") since this is filled out by
// club office-bearers, not a fixed system export — being strict about
// exact header casing would make every third upload fail for no reason.
const NAME_HEADER_RE = /^(full )?name$/i;
const EMAIL_HEADER_RE = /^email( address)?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRosterWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const members = [];
  for (const row of rows) {
    let name = null;
    let email = null;
    for (const key of Object.keys(row)) {
      if (NAME_HEADER_RE.test(key.trim())) name = String(row[key]).trim();
      if (EMAIL_HEADER_RE.test(key.trim())) email = String(row[key]).trim().toLowerCase();
    }
    if (email && EMAIL_RE.test(email)) {
      members.push({ name: name || null, email });
    }
  }
  return members;
}

const organizerController = {
  // GET /club — description, logo, roster/member list, upload control.
  // Any organizer of the club (President or VP) sees the same view.
  async clubPage(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }

      const [club, members, roster] = await Promise.all([
        Club.findById(req.user.club_id),
        ClubMember.listMembers(req.user.club_id),
        ClubRoster.findByClub(req.user.club_id),
      ]);

      res.render('organizer/club', {
        club,
        members,
        roster,
        uploaded: req.query.uploaded === '1',
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /club/roster — replaces the whole roster (see ClubRoster.replaceForClub),
  // then immediately reconciles any already-existing student accounts whose
  // email now matches, into club_members.
  async uploadRoster(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }
      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      const members = parseRosterWorkbook(req.file.buffer);
      if (!members.length) {
        return res.status(400).send('No valid rows found — the sheet needs a "Name" and "Email" column, with at least one row containing a real email.');
      }

      await ClubRoster.replaceForClub(req.user.club_id, members, req.user.id);
      await ClubRoster.reconcileClubMembers(req.user.club_id);

      res.redirect('/club?uploaded=1');
    } catch (err) {
      next(err);
    }
  },

  // GET /account (organizer branch) — see studentController.account, which
  // dispatches here-equivalent data inline; this is the POST half, letting
  // an organizer edit their own name/email.
  async updateAccount(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'organizer') {
        return res.redirect('/auth/login');
      }
      const { name, email } = req.body;
      await Organizer.update(req.user.id, { name, email });
      res.redirect('/account');
    } catch (err) {
      next(err);
    }
  },
};

module.exports = organizerController;
