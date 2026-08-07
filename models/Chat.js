const pool = require('../utils/db');

/*
  CREATE TABLE team_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) UNIQUE,   -- one official channel per team
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE unofficial_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id),          -- scoped to a team's volunteer pool
    name TEXT,
    created_by UUID REFERENCES students(id),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE channel_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL,          -- points to either team_channels.id or unofficial_groups.id
    channel_type TEXT CHECK (channel_type IN ('team_official','unofficial')) NOT NULL,
    sender_id UUID NOT NULL,
    sender_type TEXT CHECK (sender_type IN ('student','organizer')) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  Membership is NEVER stored as a list — it's derived live from
  team_members. A student sees/joins a team's official channel purely by
  being in team_members for that team_id; there's no separate "channel
  membership" table to keep in sync. See getChannelsForStudent() below.

  Write access to the OFFICIAL channel: any team member may post (this is
  the team's shared group chat) — enforce with Team.isMember() before
  calling postMessage() for channel_type='team_official'. Unofficial
  groups are likewise open write for any team member.
*/

class Chat {
  // --- Official team channel ---

  static async getOrCreateTeamChannel(teamId) {
    const existing = await pool.query(
      `SELECT * FROM team_channels WHERE team_id = $1`,
      [teamId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const { rows } = await pool.query(
      `INSERT INTO team_channels (team_id) VALUES ($1) RETURNING *`,
      [teamId]
    );
    return rows[0];
  }

  // --- Unofficial groups (student-created) ---

  static async createUnofficialGroup(teamId, name, createdByStudentId) {
    const { rows } = await pool.query(
      `INSERT INTO unofficial_groups (team_id, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [teamId, name, createdByStudentId]
    );
    return rows[0];
  }

  static async findUnofficialGroupsByTeam(teamId) {
    const { rows } = await pool.query(
      `SELECT * FROM unofficial_groups WHERE team_id = $1 ORDER BY created_at`,
      [teamId]
    );
    return rows;
  }

  // --- Messages (shared by both channel types) ---

  // Caller is responsible for the authorization check before calling this:
  // for channel_type='team_official', verify sender is a team head/organizer.
  static async postMessage({ channelId, channelType, senderId, senderType, content }) {
    const { rows } = await pool.query(
      `INSERT INTO channel_messages (channel_id, channel_type, sender_id, sender_type, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [channelId, channelType, senderId, senderType, content]
    );
    return rows[0];
  }

  static async getMessages(channelId, { limit = 50, before = null } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM channel_messages
       WHERE channel_id = $1
         AND ($3::timestamptz IS NULL OR created_at < $3)
       ORDER BY created_at DESC
       LIMIT $2`,
      [channelId, limit, before]
    );
    return rows.reverse(); // chronological order for the UI
  }

  // Same as getMessages, but with the sender's display name joined in —
  // what the group chat UI actually renders. sender_type tells us which
  // table to join (a channel mixes student and organizer senders).
  // `afterCreatedAt` supports incremental polling for new messages without
  // re-fetching the whole history — timestamp cursor, not id, since
  // channel_messages.id is a random UUID with no chronological ordering.
  static async getMessagesSince(channelId, afterCreatedAt = null, limit = 200) {
    const { rows } = await pool.query(
      `SELECT cm.*,
              COALESCE(s.name, o.name) AS sender_name
       FROM channel_messages cm
       LEFT JOIN students s ON s.id = cm.sender_id AND cm.sender_type = 'student'
       LEFT JOIN organizers o ON o.id = cm.sender_id AND cm.sender_type = 'organizer'
       WHERE cm.channel_id = $1
         AND ($2::timestamptz IS NULL OR cm.created_at > $2)
       ORDER BY cm.created_at ASC
       LIMIT $3`,
      [channelId, afterCreatedAt, limit]
    );
    return rows;
  }

  // Every channel (official + unofficial) a student should see — derived
  // purely from their team_members rows, never a stored membership list.
  static async getChannelsForStudent(studentId) {
    const official = await pool.query(
      `SELECT tc.id, tc.team_id, t.name AS team_name, 'team_official' AS channel_type
       FROM team_channels tc
       JOIN teams t ON t.id = tc.team_id
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.student_id = $1`,
      [studentId]
    );

    const unofficial = await pool.query(
      `SELECT ug.id, ug.team_id, ug.name, 'unofficial' AS channel_type
       FROM unofficial_groups ug
       JOIN team_members tm ON tm.team_id = ug.team_id
       WHERE tm.student_id = $1`,
      [studentId]
    );

    return [...official.rows, ...unofficial.rows];
  }
}

module.exports = Chat;