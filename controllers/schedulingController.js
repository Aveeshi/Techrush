const Scheduling = require('../models/Scheduling');
const readXlsxFile = require('read-excel-file/node');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseCsv(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        values.push(value.trim().replace(/^"|"$/g, ''));
        value = '';
      } else value += char;
    }
    values.push(value.trim().replace(/^"|"$/g, ''));
    return values;
  });
}

function parseTimetableRows(rows) {
  if (rows.length < 2) throw new Error('CSV must include a header and at least one timetable row.');
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[\s-]+/g, '_'));
  const required = ['room', 'class_name', 'day_of_week', 'start_time', 'end_time'];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error('CSV columns must be: room, class_name, day_of_week, start_time, end_time.');
  }

  function normalizeHeader(header) {
    return String(header || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  function parseDateValue(value, label) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    throw new Error(`${label} must be a valid date in YYYY-MM-DD format.`);
  }

  function parseDuration(value) {
    const text = String(value || '').trim().toLowerCase();
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 60);
    const clockMatch = text.match(/^(\d+):([0-5]\d)$/);
    if (clockMatch) return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);
    const hourMatch = text.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)$/);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
    const minuteMatch = text.match(/^(\d+)\s*(minutes?|mins?|m)$/);
    if (minuteMatch) return Number(minuteMatch[1]);
    throw new Error('Duration must be hours (for example 3 or 3 hrs) or HH:MM.');
  }

  function parseStartTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    }
    if (typeof value === 'number' && value >= 0 && value < 1) {
      const totalMinutes = Math.round(value * 24 * 60);
      return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    }
    const text = String(value || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(text)) throw new Error('Start time must use HH:MM format.');
    const [hours, minutes] = text.split(':').map(Number);
    if (hours > 23 || minutes > 59) throw new Error('Start time must be a valid time.');
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function normalizeRoomNumber(value) {
    const text = String(value || '').trim();
    const match = text.match(/^([a-z]\d)\s*[- ]?\s*(\d{3}[a-z]?)$/i);
    return match ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : text;
  }

  function isLegacyTimetable(rows) {
    const headers = rows[0].map(normalizeHeader);
    return ['room', 'class_name', 'day_of_week', 'start_time', 'end_time']
      .every((name) => headers.includes(name));
  }

  function parseImportedScheduleRows(rows) {
    const nonEmptyRows = rows.filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
    if (nonEmptyRows.length < 2) throw new Error('The calendar file must include a header and at least one event row.');
    const headers = nonEmptyRows[0].map(normalizeHeader);
    const required = ['name_of_event', 'room_number', 'date', 'start_day', 'end_day', 'duration', 'start_time'];
    const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
    if (Object.values(indexes).some((index) => index < 0)) {
      throw new Error('Calendar columns must be: name of event, room number, date, start day, end day, duration, start time.');
    }

    return nonEmptyRows.slice(1).map((row, index) => {
      const eventName = String(row[indexes.name_of_event] || '').trim();
      const roomNumber = normalizeRoomNumber(row[indexes.room_number]);
      const date = parseDateValue(row[indexes.date], `Date on row ${index + 2}`);
      const startDate = parseDateValue(row[indexes.start_day] || date, `Start day on row ${index + 2}`);
      const endDate = parseDateValue(row[indexes.end_day] || startDate, `End day on row ${index + 2}`);
      const durationMinutes = parseDuration(row[indexes.duration]);
      const startTime = parseStartTime(row[indexes.start_time]);
      const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
      if (!eventName || !roomNumber || endDate < startDate || durationMinutes <= 0 || startMinutes + durationMinutes > 24 * 60) {
        throw new Error(`Invalid calendar values on row ${index + 2}.`);
      }
      return { eventName, roomNumber, startDate, endDate, durationMinutes, startTime };
    });
  }

  function parseBlocks(buffer) {
    return parseTimetableRows(parseCsv(buffer.toString('utf8')));
  }

  async function parseImportedScheduleFile(file) {
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (extension === 'xlsx') {
      const rows = await readXlsxFile(file.buffer);
      if (isLegacyTimetable(rows)) {
        return { type: 'timetable', items: parseTimetableRows(rows) };
      }
      return { type: 'schedule', items: parseImportedScheduleRows(rows) };
    }
    if (extension === 'csv') {
      const rows = parseCsv(file.buffer.toString('utf8'));
      if (isLegacyTimetable(rows)) {
        return { type: 'timetable', items: parseTimetableRows(rows) };
      }
      return { type: 'schedule', items: parseImportedScheduleRows(rows) };
    }
    throw new Error('Choose a .csv or .xlsx calendar file.');
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
        currentMonth,
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
      if (!req.file) throw new Error('Choose a CSV or Excel calendar file first.');
      const imported = await parseImportedScheduleFile(req.file);
      if (imported.type === 'timetable') await Scheduling.addTimetableBlocks(imported.items);
      else await Scheduling.addImportedScheduleItems(imported.items);
      res.redirect('/scheduling?msg=Calendar+schedule+imported+successfully');
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

  async deleteManualEvent(req, res, next) {
    try {
      await Scheduling.deleteManualEvent(req.params.id);
      res.redirect(`/scheduling?month=${encodeURIComponent(String(req.query.month || req.body.month || '').slice(0, 7))}&msg=Event+deleted`);
    } catch (error) {
      res.redirect(`/scheduling?error=${encodeURIComponent(error.message)}`);
    }
  },

  async deleteImportedScheduleItem(req, res, next) {
    try {
      await Scheduling.deleteImportedScheduleItem(req.params.id);
      res.redirect(`/scheduling?month=${encodeURIComponent(String(req.query.month || req.body.month || '').slice(0, 7))}&msg=Imported+event+deleted`);
    } catch (error) {
      res.redirect(`/scheduling?error=${encodeURIComponent(error.message)}`);
    }
  },
};

module.exports = schedulingController;
