const express=require('express');
require('dotenv').config();
const crypto=require('crypto');
const helmet=require('helmet');
const http=require('http');
const { Server }=require('socket.io');
const passport=require("passport");
const GoogleStrategy=require("passport-google-oauth20").Strategy;
const path=require('path');
const cookieParser=require('cookie-parser');
const { attachUserToLocals } = require('./middleware/locals');
const EventHead=require('./models/EventHead');
const Team=require('./models/Team');

const rootDir=require("./utils/PathUtil.js");
const eventRouter=require("./routes/Eventrouter.js");
const authRouter=require("./routes/authRouter.js");
const clubRouter=require("./routes/clubRouter.js");
const skillTagRouter=require("./routes/skillTagRouter.js");
const eventTypeRouter=require("./routes/Eventtyperouter.js");
const teamRouter=require("./routes/teamRouter.js");
const studentRouter=require("./routes/studentRouter.js");
const organizerRouter=require("./routes/organizerRouter.js");
const clubEventRouter=require("./routes/clubEventRouter.js");
const logbookRouter=require("./routes/logbookRouter.js");
const studentDashboardRouter=require("./routes/studentDashboardRouter.js");
const facultyRouter=require("./routes/facultyRouter.js");
const institutionalRouter=require("./routes/institutionalRouter.js");
const schedulingRouter=require("./routes/schedulingRouter.js");
const registerChatSocket=require('./sockets/chatSocket.js');

const session=require("express-session");
const pgSession=require('connect-pg-simple')(session);
const db=require('./utils/db.js');
const multer=require('multer');
require("./config/passport.js")


const{v4:uuid}=require('uuid');

const app=express();
app.set('trust proxy', 1);
app.set('view engine','ejs');
app.set('views','views');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
if (isProduction && !sessionSecret) {
  throw new Error('SESSION_SECRET must be set in production');
}

app.use((req, res, next) => {
    res.locals.user = null;
    res.locals.isLoggedIn = false;
    res.locals.isEventHead = false;
    res.locals.isTeamHead = false;
    res.locals.theme = null;
    next();
});

app.use((req,res,next)=>{
    console.log(req.url,req.method);
    next();
});

// Pulled into a variable (rather than inlined into app.use()) so the exact
// same session middleware instance can also run in front of Socket.IO's
// handshake below — one session store, shared by HTTP and websocket alike.
const sessionStore = process.env.DATABASE_URL
  ? new pgSession({
      pool: db,
      tableName: 'session',
      createTableIfMissing: true,
    })
  : new session.MemoryStore();

const sessionMiddleware=session({
    store: sessionStore,
    secret: sessionSecret || 'development-only-session-secret',
    resave:false,
    saveUninitialized:true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
    }
});
app.use(sessionMiddleware);


app.use(passport.initialize());
app.use(passport.session());
app.use(cookieParser());
app.use(attachUserToLocals);


app.use(express.static(path.join(rootDir,"public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // needed for the scan page's fetch() POST to /events/:id/checkin

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const submittedToken = req.get('x-csrf-token') || req.body?._csrf || req.query?._csrf;
  const submittedBuffer = typeof submittedToken === 'string'
    ? Buffer.from(submittedToken)
    : null;
  const expectedBuffer = Buffer.from(req.session.csrfToken);
  if (submittedBuffer &&
      submittedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(submittedBuffer, expectedBuffer)) {
    return next();
  }

  if (req.accepts('html')) {
    return res.status(403).render('error', { message: 'Invalid CSRF token' });
  }
  return res.status(403).json({ error: 'Invalid CSRF token' });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());


// Nav-badge flags — cheap existence lookups, students only. Also exposed
// as JSON at GET /auth/me-roles (authController.meRoles) so the nav's
// client-side script can re-fetch after a 'role:updated' socket event
// without a full page reload (see views/partials/nav.ejs).
app.use(async (req, res, next) => {
  if (req.user?.type !== 'student') {
    res.locals.isEventHead = false;
    res.locals.isTeamHead = false;
    return next();
  }
  try {
    const [isEventHead, isTeamHead] = await Promise.all([
      EventHead.isHeadOfAny(req.user.id),
      Team.isHeadOfAny(req.user.id),
    ]);
    res.locals.isEventHead = isEventHead;
    res.locals.isTeamHead = isTeamHead;
    next();
  } catch (err) {
    console.warn('Role check error (fallback to false):', err.message);
    res.locals.isEventHead = false;
    res.locals.isTeamHead = false;
    next();
  }
});

// Theme cookie — read once here so every render has `theme` without each
// controller passing it explicitly. The actual dark/light values live in
// views/partials/head.ejs; this just forwards whatever's in the cookie
// ('dark'/'light'), or undefined if the visitor never toggled yet (the
// pre-paint inline script in head.ejs falls back to prefers-color-scheme
// in that case).
app.use((req, res, next) => {
  res.locals.theme = req.cookies?.theme || null;
  next();
});

// POST /theme — persists the toggle from views/partials/nav.ejs into a
// cookie read back by the middleware above on every subsequent request.
// No auth required: theme is a per-browser preference, not account data.
app.post('/theme', (req, res) => {
  const theme = req.body?.theme === 'light' ? 'light' : 'dark';
  res.cookie('theme', theme, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ theme });
});

app.use('/events', eventRouter);
app.use('/auth', authRouter);
app.use('/clubs', clubRouter);
app.use('/skill-tags', skillTagRouter);
app.use('/event-types', eventTypeRouter);
app.use('/teams', teamRouter);
app.use('/club', organizerRouter);
app.use('/club-events', clubEventRouter);
app.use('/logbook', logbookRouter);
app.use('/student', studentDashboardRouter);
app.use('/faculty', facultyRouter);
app.use('/institutional', institutionalRouter);
app.use('/scheduling', schedulingRouter);
app.use('/', studentRouter);
app.use("/",(req,res)=>{
    res.render('index');
});

// Final catch-all error handler
app.use((err, req, res, next) => {
  const message = err instanceof Error ? err.message : (err && err.message) || 'Unexpected error';
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).render('error', { message });
});


// Socket.IO
const server=http.createServer(app);
const io=new Server(server);

// Runs the SAME session + passport middleware used for HTTP requests
// against every socket's handshake request, via engine.use() (Socket.IO
// v4.6+). This is what makes socket.request.user available in
// sockets/chatSocket.js, exactly like req.user on a normal route.
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

registerChatSocket(io);

// Exposes the io instance to every Express controller via
// req.app.get('io') — that's how controllers push real-time events
// (role:updated, hours:updated) to a specific student's `user:<id>` room
// without importing sockets/chatSocket.js directly.
app.set('io', io);


const PORT = process.env.PORT || 9000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});