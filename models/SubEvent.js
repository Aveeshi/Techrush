const pool = require('../utils/db');

/*
  CREATE TABLE sub_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) NOT NULL,   -- the flagship/parent event
    event_type_id UUID REFERENCES event_types(id),
    title TEXT NOT NULL,
    description TEXT,
    venue TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    banner_url TEXT,
    status TEXT CHECK (status IN ('draft','published','ongoing','completed','cancelled')) DEFAULT 'draft',
    registration_deadline TIMESTAMPTZ,
    credit_hours NUMERIC(4,1),   -- same flat-award mechanism as events.credit_hours (see Event.js)
    created_by UUID REFERENCES organizers(id),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  A sub-event is a distinct row/table from events — NOT the same event
  with a self-reference — because a flagship ("TechRush Hackathon 2026")
  and its tracks ("Hackathon Track", "Meetup Track") are different things
  with different dates/venues/descriptions, just the same KIND of thing:
  each gets its own teams, its own event head(s), its own team heads.
  club_id/organizer_id aren't repeated here — they're inherited from the
  parent event (see findByIdWithDetails's join).

  Mirrors Event.js's method shape on purpose (create/findById/
  findByIdWithDetails/update/updateStatus) so controllers can treat an
  event and a sub-event almost identically — see clubEventController.js,
  which is the only place that actually has to know the two are
  different tables.
*/

class SubEvent {
  // Unlike a top-level event, a sub-event does NOT get any teams
  // auto-provisioned — organizers/event heads add whichever teams a
  // given track actually needs via Team.create() from the sub-event's
  // own management page. A fresh sub-event starts with zero teams.
  static async create({ eventId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, registrationDeadline, createdBy, creditHours }) {
    const { rows } = await pool.query(
      `INSERT INTO sub_events
        (event_id, event_type_id, title, description, venue, start_time, end_time, banner_url, registration_deadline, created_by, credit_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [eventId, eventTypeId, title, description, venue, startTime, endTime, bannerUrl, registrationDeadline, createdBy, creditHours || null]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM sub_events WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  // Joins in the parent event's club_id/organizer scoping and the event
  // type name — the detail-view query, same shape as Event.findByIdWithDetails.
  static async findByIdWithDetails(id) {
    const { rows } = await pool.query(
      `SELECT se.*, e.title AS event_title, e.club_id, et.name AS event_type_name
       FROM sub_events se
       JOIN events e ON e.id = se.event_id
       LEFT JOIN event_types et ON et.id = se.event_type_id
       WHERE se.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // Every sub-event under one flagship — what the Club Events list nests
  // under each top-level event, and what a flagship's own detail page shows.
  // Unfiltered by status — this is the organizer/event-head management
  // view, which needs to see drafts too.
  static async findByEvent(eventId) {
    const { rows } = await pool.query(
      `SELECT * FROM sub_events WHERE event_id = $1 ORDER BY start_time ASC`,
      [eventId]
    );
    return rows;
  }

  // Batched counterpart to findByEvent — one query for every event on the
  // Club Events list instead of one per event (see clubEventController.
  // listClubEvents). Returns a Map keyed by event_id so the caller can
  // just do `byEvent.get(event.id) || []`.
  static async findByEvents(eventIds) {
    if (!eventIds.length) return new Map();
    const { rows } = await pool.query(
      `SELECT * FROM sub_events WHERE event_id = ANY($1::uuid[]) ORDER BY start_time ASC`,
      [eventIds]
    );
    const byEvent = new Map();
    for (const row of rows) {
      if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
      byEvent.get(row.event_id).push(row);
    }
    return byEvent;
  }

  // Student-facing counterpart to findByEvent — only published sub-events,
  // same status gate Event.findForFeedWithDetails already applies to
  // flagships. This is what the flagship's public page and the
  // "hasSubEvents" badge/grid should use instead of findByEvent.
  static async findPublishedByEvent(eventId) {
    const { rows } = await pool.query(
      `SELECT * FROM sub_events WHERE event_id = $1 AND status = 'published' ORDER BY start_time ASC`,
      [eventId]
    );
    return rows;
  }

  // Batched "which of these events has at least one published sub-event"
  // check — one query for the whole feed instead of one per event (see
  // eventController.listEvents). N sequential queries fired inside a
  // Promise.all() each grab their own pool connection at once; on a small
  // pool (or a shared Supabase session-mode pooler with a hard client
  // cap) a long enough events feed could exhaust it on its own.
  static async findEventIdsWithPublishedSubEvents(eventIds) {
    if (!eventIds.length) return new Set();
    const { rows } = await pool.query(
      `SELECT DISTINCT event_id FROM sub_events WHERE event_id = ANY($1::uuid[]) AND status = 'published'`,
      [eventIds]
    );
    return new Set(rows.map((r) => r.event_id));
  }

  static async update(id, { title, description, venue, startTime, endTime, bannerUrl, registrationDeadline, eventTypeId, creditHours }) {
    const { rows } = await pool.query(
      `UPDATE sub_events
       SET title = COALESCE($2, title),
           description = COALESCE($3, description),
           venue = COALESCE($4, venue),
           start_time = COALESCE($5, start_time),
           end_time = COALESCE($6, end_time),
           banner_url = COALESCE($7, banner_url),
           registration_deadline = COALESCE($8, registration_deadline),
           event_type_id = COALESCE($9, event_type_id),
           credit_hours = $10 -- not coalesced — see Event.update's note
       WHERE id = $1
       RETURNING *`,
      [id, title, description, venue, startTime, endTime, bannerUrl, registrationDeadline, eventTypeId, creditHours || null]
    );
    return rows[0] || null;
  }

  static async updateStatus(id, status) {
    const { rows } = await pool.query(
      `UPDATE sub_events SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0] || null;
  }
}

module.exports = SubEvent;
