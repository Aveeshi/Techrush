const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const Organizer = require('../models/Organizer');

/*
  Two separate local strategies because students and organizers live in
  different tables. Name them explicitly so the router can call
  passport.authenticate('student-local', ...) vs ('organizer-local', ...).
*/

passport.use('student-local', new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const student = await User.findByEmail(email);
      if (!student) return done(null, false, { message: 'No account with that email' });
      if (!student.password_hash) {
        // Account exists but was created via Google — no password to check
        return done(null, false, { message: 'This account uses Google sign-in' });
      }
      const valid = await User.verifyPassword(password, student.password_hash);
      if (!valid) return done(null, false, { message: 'Incorrect password' });
      return done(null, { ...student, type: 'student' });
    } catch (err) {
      return done(err);
    }
  }
));

passport.use('organizer-local', new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const organizer = await Organizer.findByEmail(email);
      if (!organizer) return done(null, false, { message: 'No account with that email' });
      const valid = await Organizer.verifyPassword(password, organizer.password_hash);
      if (!valid) return done(null, false, { message: 'Incorrect password' });
      return done(null, { ...organizer, type: 'organizer' });
    } catch (err) {
      return done(err);
    }
  }
));

// Students AND organizers both use Google — the strategy no longer commits
// to a table on first sight. If the email already exists in either table,
// log in as that type. If it's brand new, stage it and force a role choice
// before anything is written to the DB.
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;

      const existingStudent = await User.findByEmail(email);
      if (existingStudent) {
        return done(null, { ...existingStudent, type: 'student' });
      }

      const existingOrganizer = await Organizer.findByEmail(email);
      if (existingOrganizer) {
        return done(null, { ...existingOrganizer, type: 'organizer' });
      }

      // Never seen before — do NOT insert into either table yet.
      // Hand back a pending object; nothing is persisted until
      // /auth/choose-role/student or /auth/choose-role/organizer commits it.
      return done(null, {
        pending: true,
        type: 'pending',
        googleId: profile.id,
        name: profile.displayName,
        email,
      });
    } catch (err) {
      return done(err);
    }
  }
));

/*
  serializeUser/deserializeUser must handle the 'pending' case too — a
  pending user isn't in students or organizers, so there's nothing to
  re-fetch from the DB. Store the staged Google data directly in the
  session for this one case; everything else re-fetches fresh as normal.
*/
passport.serializeUser((user, done) => {
  if (user.type === 'pending') {
    return done(null, { type: 'pending', googleId: user.googleId, name: user.name, email: user.email });
  }
  done(null, { id: user.id, type: user.type });
});

passport.deserializeUser(async (sessionData, done) => {
  try {
    if (sessionData.type === 'pending') {
      return done(null, { ...sessionData, pending: true });
    }
    const { id, type } = sessionData;
    const user = type === 'organizer'
      ? await Organizer.findById(id)
      : await User.findById(id);
    if (!user) return done(null, false);
    done(null, { ...user, type });
  } catch (err) {
    done(err);
  }
});

passport.deserializeUser(async ({ id, type }, done) => {
  try {
    const user = type === 'organizer'
      ? await Organizer.findById(id)
      : await User.findById(id);
    if (!user) return done(null, false);
    done(null, { ...user, type });
  } catch (err) {
    done(err);
  }
});

module.exports = passport;