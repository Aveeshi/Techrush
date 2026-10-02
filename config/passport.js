const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const Organizer = require('../models/Organizer');
const FacultyCoordinator = require('../models/FacultyCoordinator');
const InstitutionalCoordinator = require('../models/InstitutionalCoordinator');

/*
  Four distinct local strategies for each role:
  - student-local
  - organizer-local
  - faculty-local
  - institutional-local
*/

passport.use('student-local', new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const student = await User.findByEmail(email);
      if (!student) return done(null, false, { message: 'No account with that email' });
      if (!student.password_hash) {
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

passport.use('faculty-local', new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const fc = await FacultyCoordinator.findByEmail(email);
      if (!fc) return done(null, false, { message: 'No faculty coordinator account found with that email' });
      const valid = await FacultyCoordinator.verifyPassword(password, fc.password_hash);
      if (!valid) return done(null, false, { message: 'Incorrect password' });
      return done(null, { ...fc, type: 'faculty' });
    } catch (err) {
      return done(err);
    }
  }
));

passport.use('institutional-local', new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const inst = await InstitutionalCoordinator.findByEmail(email);
      if (!inst) return done(null, false, { message: 'No institutional coordinator account found with that email' });
      const valid = await InstitutionalCoordinator.verifyPassword(password, inst.password_hash);
      if (!valid) return done(null, false, { message: 'Incorrect password' });
      return done(null, { ...inst, type: 'institutional' });
    } catch (err) {
      return done(err);
    }
  }
));

// Students AND organizers both use Google
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
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
} else {
  console.warn('⚠️ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Google OAuth strategy skipped.');
}

passport.serializeUser((user, done) => {
  if (user.type === 'pending') {
    return done(null, { type: 'pending', googleId: user.googleId, name: user.name, email: user.email });
  }
  done(null, { id: user.id, type: user.type });
});

passport.deserializeUser(async (sessionData, done) => {
  try {
    if (!sessionData) return done(null, false);
    if (sessionData.type === 'pending') {
      return done(null, { ...sessionData, pending: true });
    }
    const { id, type } = sessionData;
    let user = null;
    try {
      if (type === 'organizer') {
        user = await Organizer.findById(id);
      } else if (type === 'faculty') {
        user = await FacultyCoordinator.findById(id);
      } else if (type === 'institutional') {
        user = await InstitutionalCoordinator.findById(id);
      } else {
        user = await User.findById(id);
      }
    } catch (dbErr) {
      console.warn('DB lookup in deserializeUser failed:', dbErr.message);
      return done(null, false);
    }
    if (!user) return done(null, false);
    done(null, { ...user, type });
  } catch (err) {
    console.warn('deserializeUser exception:', err.message);
    done(null, false);
  }
});

module.exports = passport;