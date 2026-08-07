const Team = require('../models/Team');
const Chat = require('../models/Chat');

/*
  Wires the real-time group chat onto an existing Socket.IO server.

  Rooms are keyed `team:<teamId>` — a message only reaches sockets that
  explicitly joined that team's room, so one team's chat can never leak
  into another's, even though every connection shares the same io instance.

  Auth: io.engine.use() (set up in app.js) runs the same session +
  passport middleware used for normal HTTP requests, against the
  underlying handshake request — so socket.request.user is populated
  exactly like req.user is on any Express route. A socket with no
  authenticated student OR organizer is disconnected immediately, and
  every event below re-checks Team.canAccessTeam() itself (never trusts
  that a prior join succeeded, the same way route handlers never trust
  the frontend). canAccessTeam is membership OR being the event head of
  the team's container OR the organizer of the owning club — an event
  head (or that organizer, above them in the same hierarchy) can
  open/post in every team's chat under their event, not just ones they
  happen to be a literal member of.
*/
function registerChatSocket(io) {
  io.on('connection', (socket) => {
    const user = socket.request.user;

    if (!user || (user.type !== 'student' && user.type !== 'organizer')) {
      socket.disconnect(true);
      return;
    }

    // Every authenticated student automatically joins their own private
    // room — this is the one place notificationsSocket.js and any
    // controller (via req.app.get('io')) needs to target to reach a
    // specific student in real time (nav role badges, live hours updates),
    // with zero extra client-side "join" step required.
    socket.join(`user:${user.id}`);

    // Client asks to join one team's room before it can send/receive in it.
    socket.on('team:join', async (teamId, ack) => {
      try {
        if (typeof teamId !== 'string') return;
        const canAccess = await Team.canAccessTeam(teamId, user);
        if (!canAccess) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not a member of this team' });
          return;
        }
        socket.join(`team:${teamId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Server error' });
      }
    });

    // Persists the message the same way the REST fallback does (Chat.js),
    // then broadcasts to everyone currently in that team's room, including
    // the sender — the client renders on the broadcast, not optimistically,
    // so everyone (sender included) sees the exact same server-confirmed copy.
    socket.on('team:message', async ({ teamId, content } = {}, ack) => {
      try {
        if (!teamId || typeof content !== 'string' || !content.trim()) return;

        const canAccess = await Team.canAccessTeam(teamId, user);
        if (!canAccess) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not a member of this team' });
          return;
        }

        const channel = await Chat.getOrCreateTeamChannel(teamId);
        const message = await Chat.postMessage({
          channelId: channel.id,
          channelType: 'team_official',
          senderId: user.id,
          senderType: user.type,
          content: content.trim(),
        });

        io.to(`team:${teamId}`).emit('team:message', {
          ...message,
          sender_name: user.name,
        });

        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Server error' });
      }
    });
  });
}

module.exports = registerChatSocket;
