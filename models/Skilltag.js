const pool = require('../utils/db');

/*
  CREATE TABLE skill_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE student_skills (
    student_id UUID REFERENCES students(id) NOT NULL,
    skill_tag_id UUID REFERENCES skill_tags(id) NOT NULL,
    PRIMARY KEY (student_id, skill_tag_id)
  );

  CREATE TABLE student_event_interests (
    student_id UUID REFERENCES students(id) NOT NULL,
    event_type_id UUID REFERENCES event_types(id) NOT NULL,
    PRIMARY KEY (student_id, event_type_id)
  );

  CREATE TABLE event_required_skills (
    event_id UUID REFERENCES events(id) NOT NULL,
    skill_tag_id UUID REFERENCES skill_tags(id) NOT NULL,
    PRIMARY KEY (event_id, skill_tag_id)
  );

  CREATE TABLE task_skill_tags (
    task_id UUID REFERENCES tasks(id) NOT NULL,
    skill_tag_id UUID REFERENCES skill_tags(id) NOT NULL,
    PRIMARY KEY (task_id, skill_tag_id)
  );

  Two SEPARATE axes at signup — don't conflate them:
  - student_skills:          "what I'd volunteer to DO"   (Python, Reel Making...)
  - student_event_interests: "what events I want to ATTEND" (Hackathon, Meetup...)

  event_required_skills and task_skill_tags both draw from the same
  skill_tags vocabulary as student_skills, so matching is a plain overlap
  query — no embeddings required for a v1. The findMatchingVolunteers /
  suggestForStudent methods below are exactly that: set-intersection
  scoring, ordered by overlap count. This is your feature #2/#5 matching
  logic in its simplest working form; swap in embeddings later only if
  tag overlap alone isn't precise enough.
*/

class SkillTag {
  // --- Tag vocabulary ---

  static async create(name) {
    const { rows } = await pool.query(
      `INSERT INTO skill_tags (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [name]
    );
    return rows[0] || null;
  }

  static async findAll() {
    const { rows } = await pool.query(`SELECT * FROM skill_tags ORDER BY name`);
    return rows;
  }

  // --- Student skills (what they'll volunteer to do) ---

  // Replaces the student's full skill set in one call — simpler for a
  // signup form / edit-profile screen than diffing add/remove individually.
  static async setStudentSkills(studentId, skillTagIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM student_skills WHERE student_id = $1`, [studentId]);
      if (skillTagIds.length) {
        const values = skillTagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO student_skills (student_id, skill_tag_id) VALUES ${values}`,
          [studentId, ...skillTagIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getStudentSkills(studentId) {
    const { rows } = await pool.query(
      `SELECT st.* FROM student_skills ss
       JOIN skill_tags st ON st.id = ss.skill_tag_id
       WHERE ss.student_id = $1`,
      [studentId]
    );
    return rows;
  }

  // Batch version of getStudentSkills for a whole roster at once (e.g. a
  // team's member list) — one query instead of N, returned as
  // { studentId: [{id, name}, ...] } so callers can attach skills to each
  // member without a round trip per person.
  static async getSkillsForStudents(studentIds) {
    if (!studentIds.length) return {};
    const { rows } = await pool.query(
      `SELECT ss.student_id, st.id, st.name
       FROM student_skills ss
       JOIN skill_tags st ON st.id = ss.skill_tag_id
       WHERE ss.student_id = ANY($1::uuid[])`,
      [studentIds]
    );
    const byStudent = {};
    for (const row of rows) {
      if (!byStudent[row.student_id]) byStudent[row.student_id] = [];
      byStudent[row.student_id].push({ id: row.id, name: row.name });
    }
    return byStudent;
  }

  // --- Student event-type interests (what they want to attend) ---

  static async setStudentEventInterests(studentId, eventTypeIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM student_event_interests WHERE student_id = $1`, [studentId]);
      if (eventTypeIds.length) {
        const values = eventTypeIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO student_event_interests (student_id, event_type_id) VALUES ${values}`,
          [studentId, ...eventTypeIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getStudentEventInterests(studentId) {
    const { rows } = await pool.query(
      `SELECT et.* FROM student_event_interests sei
       JOIN event_types et ON et.id = sei.event_type_id
       WHERE sei.student_id = $1`,
      [studentId]
    );
    return rows;
  }

  // --- Event required skills ---

  static async setEventRequiredSkills(eventId, skillTagIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM event_required_skills WHERE event_id = $1`, [eventId]);
      if (skillTagIds.length) {
        const values = skillTagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO event_required_skills (event_id, skill_tag_id) VALUES ${values}`,
          [eventId, ...skillTagIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getEventRequiredSkills(eventId) {
    const { rows } = await pool.query(
      `SELECT st.* FROM event_required_skills ers
       JOIN skill_tags st ON st.id = ers.skill_tag_id
       WHERE ers.event_id = $1`,
      [eventId]
    );
    return rows;
  }

  // --- Team required skills ---

  // What a volunteer should bring to be useful on this team — same
  // skill_tags vocabulary/checkbox format as student signup's "skills
  // you'd volunteer with" (see views/auth/signup.ejs and the team-creation
  // form it's mirrored in), so the two are directly comparable, not two
  // separate lists that happen to look similar.
  static async setTeamRequiredSkills(teamId, skillTagIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM team_required_skills WHERE team_id = $1`, [teamId]);
      if (skillTagIds.length) {
        const values = skillTagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO team_required_skills (team_id, skill_tag_id) VALUES ${values}`,
          [teamId, ...skillTagIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getTeamRequiredSkills(teamId) {
    const { rows } = await pool.query(
      `SELECT st.* FROM team_required_skills trs
       JOIN skill_tags st ON st.id = trs.skill_tag_id
       WHERE trs.team_id = $1`,
      [teamId]
    );
    return rows;
  }

  // Batch version for a list of teams at once (organizer's team-list page,
  // volunteer team picker) — one query instead of N.
  static async getRequiredSkillsForTeams(teamIds) {
    if (!teamIds.length) return {};
    const { rows } = await pool.query(
      `SELECT trs.team_id, st.id, st.name
       FROM team_required_skills trs
       JOIN skill_tags st ON st.id = trs.skill_tag_id
       WHERE trs.team_id = ANY($1::uuid[])`,
      [teamIds]
    );
    const byTeam = {};
    for (const row of rows) {
      if (!byTeam[row.team_id]) byTeam[row.team_id] = [];
      byTeam[row.team_id].push({ id: row.id, name: row.name });
    }
    return byTeam;
  }

  // --- Task skill tags ---

  static async setTaskSkills(taskId, skillTagIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM task_skill_tags WHERE task_id = $1`, [taskId]);
      if (skillTagIds.length) {
        const values = skillTagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO task_skill_tags (task_id, skill_tag_id) VALUES ${values}`,
          [taskId, ...skillTagIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getTaskSkills(taskId) {
    const { rows } = await pool.query(
      `SELECT st.* FROM task_skill_tags tst
       JOIN skill_tags st ON st.id = tst.skill_tag_id
       WHERE tst.task_id = $1`,
      [taskId]
    );
    return rows;
  }

  // --- Matching (feature #2) ---

  // For an event, rank club members by how many of the event's required
  // skills they have — this is what powers "suggested volunteers" for an
  // organizer, or "you're a good fit for this event" for a student.
  static async findMatchingVolunteers(eventId, { limit = 20 } = {}) {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.email, COUNT(*) AS matching_skill_count
       FROM event_required_skills ers
       JOIN student_skills ss ON ss.skill_tag_id = ers.skill_tag_id
       JOIN students s ON s.id = ss.student_id
       WHERE ers.event_id = $1
       GROUP BY s.id, s.name, s.email
       ORDER BY matching_skill_count DESC
       LIMIT $2`,
      [eventId, limit]
    );
    return rows;
  }

  // For a student, rank open tasks (across teams they're already in) by
  // skill overlap — feature #5, "suggested domains to volunteer under."
  static async suggestTasksForStudent(studentId, { limit = 10 } = {}) {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.group_id, COUNT(*) AS matching_skill_count
       FROM task_skill_tags tst
       JOIN student_skills ss ON ss.skill_tag_id = tst.skill_tag_id AND ss.student_id = $1
       JOIN tasks t ON t.id = tst.task_id
       WHERE t.status = 'open'
       GROUP BY t.id, t.title, t.group_id
       ORDER BY matching_skill_count DESC
       LIMIT $2`,
      [studentId, limit]
    );
    return rows;
  }

  // For a student's event feed — rank published events by overlap with
  // their event-type interests, independent of skill matching.
  static async suggestEventsForStudent(studentId, { limit = 10 } = {}) {
    const { rows } = await pool.query(
      `SELECT e.*
       FROM student_event_interests sei
       JOIN events e ON e.event_type_id = sei.event_type_id
       WHERE sei.student_id = $1 AND e.status = 'published'
       ORDER BY e.start_time ASC
       LIMIT $2`,
      [studentId, limit]
    );
    return rows;
  }
}

module.exports = SkillTag;