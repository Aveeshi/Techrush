// Live nav role badges — no page reload needed when an organizer assigns
// a student as event head / team head while they're already browsing.
//
// Every authenticated student's socket auto-joins `user:<id>` (see
// sockets/chatSocket.js), so this connection alone is enough to receive
// a 'role:updated' broadcast targeted at them. On that event, re-fetch
// GET /auth/me-roles (server truth) and toggle the `nav-role-hidden`
// class on every element tagged `data-role="isEventHead"` /
// `data-role="isTeamHead"` in nav.ejs — chips AND nav links alike.
// `data-role` may list multiple flags comma-separated (the combined "My
// Events & Teams" link) — shown if ANY listed flag is true.
(function () {
  if (typeof io !== 'function') return;

  async function refreshRoleBadges() {
    try {
      const res = await fetch('/auth/me-roles');
      if (!res.ok) return;
      const roles = await res.json();
      document.querySelectorAll('[data-role]').forEach((el) => {
        const anyTrue = el.dataset.role.split(',').some((flag) => roles[flag]);
        el.classList.toggle('nav-role-hidden', !anyTrue);
      });
    } catch (err) {
      // Silent — the badges just stay as they were server-rendered.
    }
  }

  const socket = io({ withCredentials: true });
  socket.on('role:updated', refreshRoleBadges);
})();
