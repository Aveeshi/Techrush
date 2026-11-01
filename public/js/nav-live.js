// Listens on the global Socket.IO connection for real-time role updates
// (pushed by organizers assigning/removing event heads or team heads),
// and flips the nav chips between visible and hidden without requiring
// a page reload.
(function () {
  if (typeof io !== 'function') return;

  const socket = io({ withCredentials: true });

  async function refreshRoles() {
    try {
      const res = await fetch('/auth/me-roles');
      if (!res.ok) return;
      const roles = await res.json();
      document.querySelectorAll('[data-role]').forEach((el) => {
        const anyTrue = el.dataset.role.split(',').some((flag) => roles[flag]);
        el.classList.toggle('nav-role-hidden', !anyTrue);
      });
    } catch (err) {
      // Offline / transient network failure — leave badges as they are.
    }
  }

  socket.on('role:updated', refreshRoles);
})();
