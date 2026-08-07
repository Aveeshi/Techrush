const { check, validationResult } = require('express-validator');

/*
  Shared validator chains, kept in one place since studentSignup and
  chooseRoleStudent both collect the same profile fields — writing these
  twice would mean the rules drifting apart the first time only one gets
  updated. Each route composes the subset of chains it actually needs.
*/

const nameCheck = check('name')
  .notEmpty().withMessage('Name is required')
  .trim()
  .isLength({ min: 3 }).withMessage('Name must be at least 3 characters')
  .matches(/^[a-zA-Z\s]+$/).withMessage('Name can only contain letters and spaces');

const emailCheck = check('email')
  .isEmail().withMessage('Please enter a valid email')
  .normalizeEmail();

const passwordCheck = check('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain at least one number')
  .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character')
  .trim();

const passwordCopyCheck = check('passwordCopy')
  .trim()
  .custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match');
    }
    return true;
  });

const rollNumberCheck = check('rollNumber')
  .notEmpty().withMessage('Roll number is required')
  .trim()
  .isAlphanumeric().withMessage('Roll number can only contain letters and numbers');

const departmentCheck = check('department')
  .notEmpty().withMessage('Department is required')
  .trim()
  .isLength({ min: 2 }).withMessage('Department must be at least 2 characters');

const yearCheck = check('year')
  .notEmpty().withMessage('Year is required')
  .isInt({ min: 1, max: 6 }).withMessage('Year must be a number between 1 and 6')
  .toInt();

const phoneCheck = check('phone')
  .notEmpty().withMessage('Phone number is required')
  .trim()
  .matches(/^[0-9]{10}$/).withMessage('Phone number must be exactly 10 digits');

// Reusable UUID-array validator — clubIds, skillTagIds, and
// eventTypeInterestIds all need the identical "optional array of real
// UUIDs" rule, so this is a factory instead of copy-pasting the regex
// three times. Defined before any of its call sites below.
//
// customSanitizer runs BEFORE isArray() checks the value. This matters
// because of an HTML quirk: when a browser submits a group of checkboxes
// sharing one `name`, it sends an array ONLY if 2+ are checked. With
// exactly one checked, it sends a plain string instead — so a student
// selecting just one club/skill/interest would otherwise fail isArray()
// even though they used the multiselect correctly. Coercing here means
// isArray() always sees a real array by the time it runs, regardless of
// how many boxes were checked.
function uuidArrayCheck(fieldName, entityLabel) {
  return check(fieldName)
    .optional()
    .customSanitizer((value) => {
      if (value === undefined) return value; // let .optional() handle "not sent at all"
      return Array.isArray(value) ? value : [value];
    })
    .isArray().withMessage(`${fieldName} must be an array`)
    .custom((ids) => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!ids.every((id) => typeof id === 'string' && uuidRegex.test(id))) {
        throw new Error(`${fieldName} must all be valid ${entityLabel} IDs`);
      }
      return true;
    });
}

const clubIdCheck = check('clubId')
  .notEmpty().withMessage('clubId is required')
  .isUUID().withMessage('clubId must be a valid ID');

// Organizer accounts are capped at one President + one Vice President per
// club (see Organizer.js) — the actual open-slot re-check happens in the
// controller (Organizer.isRoleOpen), this just validates the shape.
const roleCheck = check('role')
  .notEmpty().withMessage('role is required')
  .isIn(['president', 'vice_president']).withMessage('role must be president or vice_president');

// What a student would volunteer to DO (Python, Reel Making, Web Dev...)
const skillTagIdsCheck = uuidArrayCheck('skillTagIds', 'skill');

// What TYPES of events a student wants to ATTEND (Hackathon, Meetup...) —
// a separate axis from skills, per SkillTag.js. Don't conflate the two.
const eventTypeInterestIdsCheck = uuidArrayCheck('eventTypeInterestIds', 'event type');

/*
  Full chains per route. Compose from the pieces above rather than
  repeating them, so a rule change (e.g. tightening password length)
  only has to happen once.
*/

// POST /auth/student/signup
const studentSignupValidation = [
  nameCheck,
  emailCheck,
  passwordCheck,
  passwordCopyCheck,
  rollNumberCheck,
  departmentCheck,
  yearCheck,
  phoneCheck,
  skillTagIdsCheck,
  eventTypeInterestIdsCheck,
];

// POST /auth/student/login — deliberately loose. Don't re-run signup-strength
// rules here: a login with an old, weaker password (created before rules
// tightened) should still fail with "incorrect password" from bcrypt, not
// get rejected by validation before it even reaches the database.
const studentLoginValidation = [
  check('email').isEmail().withMessage('Please enter a valid email').normalizeEmail(),
  check('password').notEmpty().withMessage('Password is required'),
];

// POST /auth/organizer/login — same reasoning as student login
const organizerLoginValidation = [
  check('email').isEmail().withMessage('Please enter a valid email').normalizeEmail(),
  check('password').notEmpty().withMessage('Password is required'),
];

// POST /auth/choose-role/student — no name/email/password here, since
// those came from Google, not the form. Only the fields the tab collects.
const chooseRoleStudentValidation = [
  rollNumberCheck,
  departmentCheck,
  yearCheck,
  phoneCheck,
  skillTagIdsCheck,
  eventTypeInterestIdsCheck,
];

// POST /auth/signup (organizer branch) — name/email/password same rules
// as student, but a clubId + role instead of the array + skills/interests,
// since organizers don't have those two axes.
const organizerSignupValidation = [
  nameCheck,
  emailCheck,
  passwordCheck,
  passwordCopyCheck,
  clubIdCheck,
  roleCheck,
];

// POST /auth/choose-role/organizer
const chooseRoleOrganizerValidation = [
  clubIdCheck,
  roleCheck,
];

/*
  POST /auth/signup is ONE route handling BOTH student and organizer
  signup from a single form (see signup.ejs's tab toggle) — which
  validator array applies depends on req.body.typeOfUser, which isn't
  known until the request arrives, so it can't be a static router-level
  middleware array like the other routes. This function runs the correct
  chain manually before the controller checks validationResult.
*/
async function runSignupValidation(req, res, next) {
  const chain = req.body.typeOfUser === 'organizer'
    ? organizerSignupValidation
    : studentSignupValidation;
  await Promise.all(chain.map((validator) => validator.run(req)));
  next();
}

module.exports = {
  // Bundled chains — use these when a route wants the full standard set
  studentSignupValidation,
  organizerSignupValidation,
  runSignupValidation,
  studentLoginValidation,
  organizerLoginValidation,
  chooseRoleStudentValidation,
  chooseRoleOrganizerValidation,

  // Individual checks — use these when a route needs only one or two
  // fields (e.g. an edit-profile route that only touches phone/department).
  // Pulling from here keeps every route using the exact same rule instead
  // of a route rewriting its own version that quietly drifts over time.
  nameCheck,
  emailCheck,
  passwordCheck,
  passwordCopyCheck,
  rollNumberCheck,
  departmentCheck,
  yearCheck,
  phoneCheck,
  clubIdCheck,
  roleCheck,
  skillTagIdsCheck,
  eventTypeInterestIdsCheck,
};