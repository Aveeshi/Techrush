const Scheduling = require('../models/Scheduling');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseCsv(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        values.push(value.trim());
        value = '';
      } else value += char;
    }
    values.push(value.trim());
    return values;
  });
}

function parseBlocks(buffer) {
  const rows = parseCsv(buffer.toString('utf8'));
  if (rows.length < 2) throw new Error('CSV must include a header and at least one timetable row.');
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[\s-]+/g, '_'));
  const required = ['room', 'class_name', 'day_of_week', 'start_time', 'end_time'];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error('CSV columns must be: room, class_name, day_of_week, start_time, end_time.');
  }

  return rows.slice(1).map((row, index) => {
    const dayValue = row[indexes.day_of_week];
    const numericDay = Number(dayValue);
    const dayOfWeek = Number.isInteger(numericDay)
      ? numericDay
      : DAY_NAMES.findIndex((name) => name.toLowerCase() === dayValue.toLowerCase());
    const block = {
      roomName: row[indexes.room],
      className: row[indexes.class_name],
      dayOfWeek,
      startTime: row[indexes.start_time],
      endTime: row[indexes.end_time],
    };
    if (!block.roomName || !block.className || dayOfWeek < 0 || dayOfWeek > 6 || !/^\d{2}:\d{2}/.test(block.startTime) || !/^\d{2}:\d{2}/.test(block.endTime)) {
      throw new Error(`Invalid timetable values on CSV row ${index + 2}.`);
    }
    return block;
  });
}

const schedulingController = {
  async calendar(req, res, next) {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const calendar = await Scheduling.getCalendar(req.query.month || currentMonth);
      const pool = require('../utils/db');
      const clubsResult = await pool.query(`SELECT id, name FROM clubs ORDER BY name`);
      res.render('scheduling/calendar', {
        user: req.user,
        calendar,
        clubs: clubsResult.rows,
        message: req.query.msg || null,
        error: req.query.error || null,
      });
    } catch (error) {
      next(error);
    }
  },

  async importTimetable(req, res, next) {
    try {
      if (!req.file) throw new Error('Choose a CSV timetable file first.');
      await Scheduling.addTimetableBlocks(parseBlocks(req.file.buffer));
      res.redirect('/scheduling?msg=Timetable+imported+successfully');
    } catch (error) {
      res.redirect(`/scheduling?error=${encodeURIComponent(error.message)}`);
    }
  },

  async addRoom(req, res, next) {
    try {
      const name = String(req.body.name || '').trim();
      if (!name) throw new Error('Room name is required.');
      await Scheduling.addRoom(name);
      res.redirect('/scheduling?msg=Room+added');
    } catch (error) {
      res.redirect(`/scheduling?error=${encodeURIComponent(error.message)}`);
    }
  },

  async addManualEvent(req, res, next) {
    try {
      await Scheduling.addManualEvent({
        title: String(req.body.title || '').trim(),
        eventDate: String(req.body.eventDate || '').trim(),
        roomName: String(req.body.roomName || '').trim(),
        startTime: String(req.body.startTime || '').trim(),
        endTime: String(req.body.endTime || '').trim(),
        createdBy: req.user.id,
        clubId: req.user.type === 'faculty' ? req.user.club_id : String(req.body.clubId || '').trim(),
      });
      res.redirect(`/scheduling?month=${encodeURIComponent(String(req.body.eventDate).slice(0, 7))}&msg=Event+added+to+availability+calendar`);
    } catch (error) {
      res.redirect(`/scheduling?error=${encodeURIComponent(error.message)}`);
    }
  },
};

module.exports = schedulingController;
