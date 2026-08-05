const Team = require('../models/Team');

// Blocks any unauthenticated request, regardless of type
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Login required' });
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.isAuthenticated() || req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student account required' });
  }
  next();
}

function requireOrganizer(req, res, next) {
  if (!req.isAuthenticated() || req.user.type !== 'organizer') {
    return res.status(403).json({ error: 'Organizer account required' });
  }
  next();
}

// Use on any route where a student must be the head of the team named in
// req.params.teamId (e.g. creating/assigning tasks, marking attendance,
// verifying hours). This is the enforcement point for the whole
// team_heads authority model — see Team.isTeamHead().
async function requireTeamHead(req, res, next) {
  if (!req.isAuthenticated() || req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student account required' });
  }
  const { teamId } = req.params;
  const isHead = await Team.isTeamHead(teamId, req.user.id);
  if (!isHead) {
    return res.status(403).json({ error: 'Only this team\'s head can do that' });
  }
  next();
}

module.exports = { requireAuth, requireStudent, requireOrganizer, requireTeamHead };