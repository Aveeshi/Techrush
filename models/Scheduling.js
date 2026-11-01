const pool = require('../utils/db');

let schemaPromise;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS campus_rooms (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        room_type TEXT NOT NULL DEFAULT 'Class',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE campus_rooms ADD COLUMN IF NOT EXISTS room_type TEXT NOT NULL DEFAULT 'Class';
      CREATE TABLE IF NOT EXISTS timetable_blocks (
        id BIGSERIAL PRIMARY KEY,
        room_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (end_time > start_time)
      );
      CREATE TABLE IF NOT EXISTS manual_schedule_events (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID,
        title TEXT NOT NULL,
        event_date DATE NOT NULL,
        room_name TEXT,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (end_time > start_time)
      );
      CREATE TABLE IF NOT EXISTS schedule_import_items (
        id BIGSERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        room_number TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        start_time TIME NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (end_date >= start_date)
      );
      CREATE INDEX IF NOT EXISTS schedule_import_items_dates_idx
        ON schedule_import_items (start_date, end_date);
      ALTER TABLE manual_schedule_events ADD COLUMN IF NOT EXISTS event_id UUID;
      INSERT INTO campus_rooms (name, room_type) VALUES
        ('A1-209', 'Class'), ('A1-208', 'Class'), ('A1-204', 'Class'),
        ('A1-203', 'Class'), ('A1-202', 'Class'), ('A1-102', 'Class'),
        ('A1-103', 'Class'), ('A1-105', 'Class'), ('A1-008', 'Class'),
        ('A1-303', 'Class'), ('A1-306', 'Class'), ('A1-307', 'Class'),
        ('A1-302', 'Class'), ('A1-314', 'Lab'),
        ('A1-211', 'Class'), ('A1-212', 'Class'), ('A1-213', 'Class'),
        ('A1-101', 'Class'), ('A1-112', 'Class'), ('A1-111', 'Class'),
        ('A1-115', 'Class'), ('A1-311', 'Class'), ('A1-310', 'Class'),
        ('A1-309', 'Class'),
        ('Computer Seminar Hall', 'Seminar Hall'),
        ('Auditorium', 'Seminar Hall'),
        ('A2-301', 'Class'), ('A2-304', 'Class'), ('A2-401', 'Class'),
        ('A2-303', 'Lab'), ('A2-302', 'Lab'), ('A2-404', 'Lab'),
        ('A2-405', 'Lab'), ('A2-403', 'Lab'), ('A2-402', 'Lab'),
        ('A2-503A', 'Lab'), ('A2-503B', 'Lab'), ('A2-502A', 'Lab'),
        ('A2-502B', 'Lab'),
        ('IT Seminar Hall', 'Seminar Hall'),
        ('ENTC Seminar Hall', 'Seminar Hall'),
        ('A3-301', 'Lab'), ('A3-302', 'Lab'), ('A3-309', 'Lab'),
        ('A3-303', 'Lab'), ('A3-304', 'Lab'), ('A3-305', 'Lab'),
        ('A3-404', 'Lab'), ('A3-403', 'Lab'), ('A3-402', 'Lab'),
        ('A3-401', 'Lab'), ('A3-505', 'Lab'), ('A3-504', 'Lab'),
        ('A3-503', 'Lab'), ('A3-502', 'Lab'), ('A3-501', 'Lab'),
        ('A3-201', 'Lab'), ('A3-202', 'Lab'), ('A3-203', 'Lab'),
        ('A3-204', 'Lab'), ('A3-206', 'Lab'), ('A3-205', 'Lab'),
        ('A3-105', 'Lab'), ('A3-104', 'Lab'), ('A3-103', 'Lab'),
        ('A3-102', 'Lab'), ('A3-101', 'Lab'),
        ('A3-308', 'Class'), ('A3-307', 'Class'), ('A3-405', 'Class'),
        ('A3-406', 'Class'), ('A3-407', 'Class'), ('A3-408', 'Class'),
        ('A3-507', 'Class'), ('A3-508', 'Class'), ('A3-509', 'Class'),
        ('A3-510', 'Class'), ('A3-208', 'Class'), ('A3-207', 'Class'),
        ('A3-107', 'Class'), ('A3-108', 'Class'), ('A3-109', 'Class'),
        ('A3-010', 'Class'), ('A3-007', 'Class'),
        ('Auditorium A1-101', 'Seminar Hall'),
        ('Auditorium A1-102', 'Seminar Hall'),
        ('Auditorium A1-103', 'Seminar Hall')
      ON CONFLICT (name) DO NOTHING;
    `);
  }
  return schemaPromise;
}

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new Error('Invalid calendar month');
  }
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end, year, monthNumber };
}

async function getCalendar(month) {
  await ensureSchema();
  const { start, end, year, monthNumber } = monthBounds(month);
  const [roomsResult, timetableResult, eventsResult, manualEventsResult, importedScheduleResult] = await Promise.all([
    pool.query(`SELECT id, name, room_type FROM campus_rooms WHERE active = TRUE ORDER BY name`),
    pool.query(`SELECT room_name, class_name, day_of_week, start_time, end_time
                FROM timetable_blocks ORDER BY room_name, day_of_week, start_time`),
    pool.query(
      `SELECT e.id, e.title, e.venue, e.start_time, e.end_time, c.name AS club_name
       FROM events e
       LEFT JOIN clubs c ON c.id = e.club_id
       LEFT JOIN manual_schedule_events mse ON mse.event_id = e.id
       WHERE e.status <> 'cancelled'
         AND mse.id IS NULL
         AND e.start_time < $2 AND e.end_time > $1
       ORDER BY e.start_time`,
      [start, end]
    ),
    pool.query(
      `SELECT id, title, event_date::text AS event_date, room_name, start_time::text AS start_time, end_time::text AS end_time
       FROM manual_schedule_events
       WHERE event_date >= $1::date AND event_date < $2::date
       ORDER BY event_date, start_time`,
      [start, end]
    ),
    pool.query(
      `SELECT id, event_name, room_number, start_date::text AS start_date,
              end_date::text AS end_date, duration_minutes,
              start_time::text AS start_time
       FROM schedule_import_items
       WHERE start_date < $2::date AND end_date >= $1::date
       ORDER BY start_date, start_time, room_number`,
      [start, end]
    ),
  ]);

  const days = [];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    const dayOfWeek = date.getUTCDay();
    const dateKey = date.toISOString().slice(0, 10);
    const events = eventsResult.rows.filter((event) => event.start_time.toISOString().slice(0, 10) === dateKey);
    const timetable = timetableResult.rows.filter((block) => Number(block.day_of_week) === dayOfWeek);
    const manualEvents = manualEventsResult.rows.filter((event) => String(event.event_date).slice(0, 10) === dateKey);
    const importedSchedule = importedScheduleResult.rows.filter((item) => (
      dateKey >= item.start_date.slice(0, 10) && dateKey <= item.end_date.slice(0, 10)
    ));
    days.push({
      date: dateKey,
      day: dayOfWeek,
      dayNumber: day,
      busy: events.length > 0 || timetable.length > 0 || manualEvents.length > 0 || importedSchedule.length > 0,
      events,
      timetable,
      manualEvents,
      importedSchedule,
    });
  }

  return {
    month,
    monthLabel: new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    firstDay: new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay(),
    rooms: roomsResult.rows,
    days,
    events: eventsResult.rows,
    manualEvents: manualEventsResult.rows,
    timetable: timetableResult.rows,
    importedSchedule: importedScheduleResult.rows,
  };
}

async function addTimetableBlocks(blocks) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const block of blocks) {
      await client.query(
        `INSERT INTO timetable_blocks (room_name, class_name, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [block.roomName, block.className, block.dayOfWeek, block.startTime, block.endTime]
      );
      await client.query(`INSERT INTO campus_rooms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [block.roomName]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addRoom(name) {
  await ensureSchema();
  await pool.query(`INSERT INTO campus_rooms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
}

async function addManualEvent({ title, eventDate, roomName, startTime, endTime, createdBy, clubId }) {
  await ensureSchema();
  if (!title || !eventDate || !startTime || !endTime) {
    throw new Error('Title, date, start time, and end time are required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) {
    throw new Error('Enter a valid date and a start time before the end time.');
  }
  const clubResult = clubId
    ? await pool.query(`SELECT id FROM clubs WHERE id = $1`, [clubId])
    : await pool.query(`SELECT id FROM clubs ORDER BY name LIMIT 1`);
  if (!clubResult.rows[0]) throw new Error('Create a club before adding a student-facing event.');
  if (roomName) {
    await pool.query(`INSERT INTO campus_rooms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [roomName]);
  }
  const startTimestamp = `${eventDate}T${startTime}:00`;
  const endTimestamp = `${eventDate}T${endTime}:00`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `INSERT INTO events
        (club_id, title, description, venue, start_time, end_time, status, visibility, credit_hours)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', 'public', 0)
       RETURNING id`,
      [
        clubResult.rows[0].id,
        title,
        'Campus event planned through the availability calendar.',
        roomName || 'Campus-wide event',
        startTimestamp,
        endTimestamp,
      ]
    );
    await client.query(
      `INSERT INTO manual_schedule_events
        (event_id, title, event_date, room_name, start_time, end_time, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventResult.rows[0].id, title, eventDate, roomName || null, startTime, endTime, createdBy || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addImportedScheduleItems(items) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(
        `INSERT INTO schedule_import_items
          (event_name, room_number, start_date, end_date, duration_minutes, start_time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.eventName, item.roomNumber, item.startDate, item.endDate, item.durationMinutes, item.startTime]
      );
      await client.query(
        `INSERT INTO campus_rooms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [item.roomNumber]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureSchema,
  getCalendar,
  addTimetableBlocks,
  addImportedScheduleItems,
  addRoom,
  addManualEvent,
};
