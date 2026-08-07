const pool = require('../utils/db');

/*
  CREATE TABLE event_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) NOT NULL,
    url TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  UNIQUE INDEX event_images_one_primary_per_event ON event_images(event_id) WHERE is_primary;

  A flagship event's photo gallery — the primary image doubles as the
  thumbnail on the events feed card and the event page's banner, the rest
  are the carousel's other slides (see show.ejs). events.banner_url stays
  in sync with whichever row here is_primary (see clubEventController's
  createEvent/updateEvent), so every existing "show the banner" template
  path (events.ejs, registered-events.ejs, teams.ejs, ...) needed zero
  changes — they were already reading banner_url.

  Sub-events don't get this — they keep a single banner_url with no
  gallery, per the original scope of this feature.
*/

class EventImage {
  static async create({ eventId, url, isPrimary = false, sortOrder = 0 }) {
    const { rows } = await pool.query(
      `INSERT INTO event_images (event_id, url, is_primary, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [eventId, url, isPrimary, sortOrder]
    );
    return rows[0];
  }

  // Primary image first, then by upload order — this is the exact order
  // the carousel (show.ejs) and any future gallery admin UI should render.
  static async findByEvent(eventId) {
    const { rows } = await pool.query(
      `SELECT * FROM event_images WHERE event_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [eventId]
    );
    return rows;
  }

  // Unsets any existing primary for this event before setting the new
  // one — done as a transaction so the partial unique index never sees
  // two primaries at once, even momentarily.
  static async setPrimary(eventId, imageId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE event_images SET is_primary = false WHERE event_id = $1`, [eventId]);
      await client.query(`UPDATE event_images SET is_primary = true WHERE id = $1 AND event_id = $2`, [imageId, eventId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async deleteById(id) {
    await pool.query(`DELETE FROM event_images WHERE id = $1`, [id]);
  }
}

module.exports = EventImage;
