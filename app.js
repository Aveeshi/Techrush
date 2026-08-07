const express=require('express');
require('dotenv').config();
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
const registerChatSocket=require('./sockets/chatSocket.js');
// const errorController=require("./controller/errors.js");

const { title } = require('process');
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

app.use((req,res,next)=>{
    console.log(req.url,req.method);
    next();
});

// Pulled into a variable (rather than inlined into app.use()) so the exact
// same session middleware instance can also run in front of Socket.IO's
// handshake below — one session store, shared by HTTP and websocket alike.
const sessionMiddleware=session({
    store: new pgSession({
        pool:db,
        tableName:'session',
        createTableIfMissing:true
    }),
    secret: process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
});
app.use(sessionMiddleware);

app.use((req,res,next)=>{
    req.isLoggedIn=req.session.isLoggedIn;
    res.locals.isLoggedIn = req.isLoggedIn;
    res.locals.user = req.session.user ;
    next();
});

app.use(passport.initialize());
app.use(passport.session());
app.use(attachUserToLocals);


app.use(express.static(path.join(rootDir,"public")));
// app.use('/uploads', express.static(path.join(rootDir, 'uploads')));
app.use(express.urlencoded());
app.use(express.json()); // needed for the scan page's fetch() POST to /events/:id/checkin

app.get('/favicon.ico', (req, res) => res.status(204).end());
// app.use("/organizer",);
// app.use("/auth",);

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

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
    next(err);
  }
});

// Theme cookie — read once here so every render has `theme` without each
// controller passing it explicitly. The actual dark/light values live in
// views/partials/head.ejs; this just forwards whatever's in the cookie
// ('dark'/'light'), or undefined if the visitor never toggled yet (the
// pre-paint inline script in head.ejs falls back to prefers-color-scheme
// in that case).
app.use(cookieParser());
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
app.use('/', studentRouter);
app.use("/",(req,res)=>{
    res.render('index');
});
// app.use(errorController.pageNotFound);


// Socket.IO needs the raw http.Server (not the express app) so it can
// upgrade the same port's connections to websockets — app.listen() below
// is replaced with server.listen() for this reason.
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