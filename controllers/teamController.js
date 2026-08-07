const Team = require('../models/Team');
const Event = require('../models/Event');
const SubEvent = require('../models/SubEvent');
const Group = require('../models/Group');
const Task = require('../models/Task');
const TaskAssignment = require('../models/Taskassignment');
const Chat = require('../models/Chat');
const { notifyRoleUpdated } = require('./clubEventController');

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const teamController = {
  // GET /teams/event/:eventId
  // Second level: just the teams within one event that this student has
  // actually joined (e.g. 3 of that event's 5 teams).
  async myTeamsForEvent(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const { eventId } = req.params;
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).render('not-found');
      }
      const teams = await Team.findByStudentAndEvent(eventId, req.user.id);
      // Reached from a "My Events & Teams" card (team head or volunteer
      // tag) — back always returns there, not to the old standalone
      // "Teams" tab (now merged into it).
      res.render('team-list-for-event', {
        event, teams,
        backUrl: '/my-events',
        manageTeamsUrl: `/events/${eventId}/volunteer-teams`,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /teams/sub-event/:subEventId
  // Sub-event counterpart to myTeamsForEvent.
  async myTeamsForSubEvent(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }
      const { subEventId } = req.params;
      const subEvent = await SubEvent.findById(subEventId);
      if (!subEvent) {
        return res.status(404).render('not-found');
      }
      const teams = await Team.findByStudentAndSubEvent(subEventId, req.user.id);
      res.render('team-list-for-event', {
        event: subEvent, teams,
        backUrl: '/my-events',
        manageTeamsUrl: `/events/${subEvent.event_id}/sub-events/${subEventId}/volunteer-teams`,
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /teams/:teamId
  // Tasks assigned to me (left) + this team's group chat (right). Gated
  // on Team.canAccessTeam — actual team_members membership OR being the
  // event head of this team's container, not just being logged in — a
  // student can't browse another team's chat by guessing its id, but an
  // event head CAN open every team under their event, chat included.
  async teamDetail(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const { teamId } = req.params;
      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).render('not-found');
      }

      const canAccess = await Team.canAccessTeam(teamId, req.user.id);
      if (!canAccess) {
        return res.status(403).send("You're not a member of this team");
      }

      const myTasks = await TaskAssignment.findByStudentAndTeam(teamId, req.user.id);

      // For each of my tasks, pull the full assignee roster so the "who
      // else is on this" popup doesn't need a separate round trip per click.
      const tasksWithAssignees = await Promise.all(
        myTasks.map(async (task) => ({
          ...task,
          assignees: await TaskAssignment.findByTask(task.id),
        }))
      );

      const channel = await Chat.getOrCreateTeamChannel(teamId);
      const messages = await Chat.getMessagesSince(channel.id);

      res.render('team-detail', {
        team,
        tasks: tasksWithAssignees,
        channel,
        messages,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /teams/:teamId/chat
  // Posts one message to the team's official group chat, then redirects
  // back — any team member (or this team's event head — see
  // Team.canAccessTeam) may post (see Chat.js).
  async postChatMessage(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.redirect('/auth/login');
      }

      const { teamId } = req.params;
      const canAccess = await Team.canAccessTeam(teamId, req.user.id);
      if (!canAccess) {
        return res.status(403).send("You're not a member of this team");
      }

      const { content } = req.body;
      if (content && content.trim()) {
        const channel = await Chat.getOrCreateTeamChannel(teamId);
        await Chat.postMessage({
          channelId: channel.id,
          channelType: 'team_official',
          senderId: req.user.id,
          senderType: 'student',
          content: content.trim(),
        });
      }

      res.redirect(`/teams/${teamId}#chat`);
    } catch (err) {
      next(err);
    }
  },

  // GET /teams/:teamId/chat/messages?after=<ISO timestamp>
  // JSON — polled by the chat panel's JS to pick up new messages without a
  // full page reload. `after` is optional; omit it for the full backlog.
  async chatMessagesJson(req, res, next) {
    try {
      if (!req.user || req.user.type !== 'student') {
        return res.status(401).json({ error: 'Login required' });
      }

      const { teamId } = req.params;
      const canAccess = await Team.canAccessTeam(teamId, req.user.id);
      if (!canAccess) {
        return res.status(403).json({ error: "Not a member of this team" });
      }

      const channel = await Chat.getOrCreateTeamChannel(teamId);
      const after = req.query.after || null;
      const messages = await Chat.getMessagesSince(channel.id, after);
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  },

  // GET /teams/:teamId/manage — the unified team-management page, reached
  // either from an event head's "Manage team ->" link on their event's
  // detail page, or from a team head's own "My Teams" list. Gated by
  // requireTeamHead (router-level), which already resolved req.team and
  // allows EITHER this team's own head OR its container's event head —
  // "an event head has all the authorities of team heads" falls out of
  // that single check, not a second parallel code path here.
  async teamManagePage(req, res, next) {
    try {
      const team = req.team;
      const [members, heads, tasks] = await Promise.all([
        Team.listMembers(team.id),
        Team.getHeads(team.id),
        Task.findByTeam(team.id),
      ]);
      const tasksWithAssignees = await Promise.all(
        tasks.map(async (t) => ({ ...t, assignees: await TaskAssignment.findByTask(t.id) }))
      );
      res.render('team-manage', {
        team,
        members,
        heads,
        incompleteTasks: tasksWithAssignees.filter((t) => t.status !== 'verified'),
        completedTasks: tasksWithAssignees.filter((t) => t.status === 'verified'),
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /teams/:teamId/head — same Team.assignHead authority an
  // organizer already has via clubEventController.assignTeamHead, just
  // also reachable by this team's own head or its event head.
  async assignHead(req, res, next) {
    try {
      const team = req.team;
      const { studentId } = req.body;
      if (studentId) {
        await Team.assignHead(team.id, studentId, req.user.type === 'organizer' ? req.user.id : null);
        notifyRoleUpdated(req, studentId);
      }
      res.redirect(`/teams/${team.id}/manage`);
    } catch (err) {
      next(err);
    }
  },

  // POST /teams/:teamId/tasks — same shape as clubEventController.createTask,
  // just under the unified team-manage auth check instead of requireEventManager.
  async createTask(req, res, next) {
    try {
      const team = req.team;
      const { title, description, assignedHours, dueAt, assignMode, studentIds } = req.body;

      if (!title || !assignedHours) {
        return res.redirect(`/teams/${team.id}/manage`);
      }

      const group = await Group.findByTeam(team.id);
      const task = await Task.create({
        groupId: group.id,
        title,
        description: description || null,
        assignedHours,
        domainTags: null,
        createdBy: req.user.id,
        createdByType: 'team_head',
        dueAt: dueAt || null,
      });

      const targetIds = assignMode === 'whole_team'
        ? (await Team.listMembers(team.id)).map((m) => m.id)
        : toArray(studentIds);

      if (targetIds.length) {
        await TaskAssignment.assignBulk(task.id, targetIds, req.user.id);
      }

      res.redirect(`/teams/${team.id}/manage`);
    } catch (err) {
      next(err);
    }
  },

  // POST /teams/:teamId/tasks/:taskId/complete
  // Body: presentStudentIds — whoever the head checked in the "who showed
  // up" popup. Everyone else originally assigned to this task is marked
  // absent. One action = attendance + hours + verified for the present
  // ones (see TaskAssignment.markAttendanceAndVerify) — no separate
  // student self-report step. Emits 'hours:updated' to every present
  // student so their /account "My Hours" table updates live.
  async completeTask(req, res, next) {
    try {
      const team = req.team;
      const { taskId } = req.params;

      const task = await Task.findById(taskId);
      const group = await Group.findByTeam(team.id);
      if (!task || task.group_id !== group.id) {
        return res.status(404).render('not-found');
      }

      const assignees = await TaskAssignment.findByTask(taskId);
      const allIds = assignees.map((a) => a.student_id);
      const presentIds = toArray(req.body.presentStudentIds).filter((id) => allIds.includes(id));
      const absentIds = allIds.filter((id) => !presentIds.includes(id));

      await TaskAssignment.markAttendanceAndVerify(
        taskId,
        { presentIds, absentIds },
        task.assigned_hours,
        req.user.id,
        'team_head'
      );
      await Task.updateStatus(taskId, 'verified');

      const io = req.app.get('io');
      presentIds.forEach((studentId) => io.to(`user:${studentId}`).emit('hours:updated'));

      res.redirect(`/teams/${team.id}/manage`);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = teamController;
