# TechRush / CampusBuzz

CampusBuzz is a campus activity management platform for events, clubs, student participation, attendance, CCA credit tracking, faculty review, institutional administration, and room availability planning.

## Features

- Student signup, login, profile, event registration, attendance, and credited-hours tracking.
- President / Chairperson event and club management.
- Faculty coordinator event approval, reports, and student-coordinator assignments.
- Institutional administration dashboards and club oversight.
- Event teams, task assignments, skills, QR attendance scanning, and chat.
- Interactive room availability calendar with:
  - Daily room details and time slots.
  - Available, occupied, classroom, lab, and seminar-hall filters.
  - CSV and Excel schedule imports.
  - Multi-day schedule entries with duration-based end times.
  - Calendar-managed event deletion.
- Security protections including Helmet, CSP nonces, CSRF protection, secure production sessions, validation, and login rate limiting.

## Requirements

- Node.js 20 or newer.
- npm.
- PostgreSQL. Supabase PostgreSQL works with the current configuration.
- Cloudinary account for image uploads.
- Optional Google OAuth credentials for Google sign-in.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root:

   ```env
   NODE_ENV=development
   PORT=9000
   DATABASE_URL=postgresql://user:password@host:5432/database
   SESSION_SECRET=replace-with-a-long-random-secret

   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret

   # Optional: enables Google student sign-in.
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

   Never commit `.env` or real credentials. In production, `SESSION_SECRET` is required and must be a long, unpredictable value.

3. Seed the base lookup data:

   ```bash
   node seed.js
   ```

4. Run the application:

   ```bash
   npm start
   ```

   The default local URL is <http://localhost:9000>.

   For development with automatic restarts:

   ```bash
   npm run dev
   ```

## Database and migrations

The application creates some feature tables on first use, including scheduling tables. Feature migrations and seed scripts are in [`scripts/`](./scripts).

Run a script explicitly when its feature is needed:

```bash
node scripts/2026-10-02-institutional-faculty-features.js
node scripts/2026-10-03-pasc-comprehensive-seed.js
```

The migration script creates faculty and institutional coordinator tables and seeds development credentials when those tables are empty. Change all seeded passwords before production use.

Other scripts add or migrate feature data:

- `2026-08-06-subevent-registrations.js`
- `2026-08-07-images-and-avatars.js`
- `2026-08-08-default-teams.js`
- `2026-08-11-event-credit-hours.js`
- `2026-08-11-logbook.js`
- `2026-08-12-team-capacity-and-skills.js`
- `2026-08-12-verified-organizers.js`
- `2026-10-02-institutional-faculty-features.js`
- `2026-10-03-pasc-comprehensive-seed.js`

Most scripts are intended for a configured development database. Review a script before running it against production, especially scripts that delete or replace seed data.

## Authentication portals

The login screen provides separate portal modes for:

- Student
- President / Chairperson
- Faculty
- Institution

Faculty and institutional users must use the corresponding portal. The internal role name `organizer` is retained for backend compatibility, while the UI presents the role as President / Chairperson.

## Calendar schedule import

Faculty and institutional users can open `/scheduling` and import either CSV or `.xlsx` files.

The preferred calendar columns are:

```text
name of event, room number, date, start day, end day, duration, start time
```

Example:

```csv
name of event,room number,date,start day,end day,duration,start time
Workshop,A1-209,2026-11-05,2026-11-05,2026-11-09,3,14:00
```

The example reserves `A1-209` from 14:00 to 17:00 on every date from November 5 through November 9. Duration may be supplied as hours, `HH:MM`, or minutes.

The legacy recurring timetable format is still supported:

```text
room, class_name, day_of_week, start_time, end_time
```

Room names are normalized when imported, so values such as `A1 209`, `A1-209`, and `a1 209` map to the same room.

## Room inventory

The scheduling model seeds the configured campus inventory, including:

- A1, A2, and A3 classrooms.
- A1, A2, and A3 laboratories.
- Computer, IT, and ENTC seminar halls.
- Auditorium.

Rooms are categorized as `Class`, `Lab`, or `Seminar Hall`. Additional rooms can be added from the calendar page.

## Useful commands

```bash
npm run dev       # Start with nodemon
npm start         # Start the production-style Node server
npm run build     # Rebuild public/output.css
node seed.js      # Seed clubs, event types, and skill tags
```

## Production checklist

- Set `NODE_ENV=production`.
- Set a strong, unique `SESSION_SECRET`.
- Use a managed PostgreSQL connection with restricted credentials.
- Configure Cloudinary credentials through the deployment secret manager.
- Configure Google OAuth redirect URLs only if Google login is enabled.
- Change or remove all development seed credentials.
- Run `npm audit --omit=dev --audit-level=moderate`.
- Serve the application behind HTTPS.
- Back up the database before running migrations or seed scripts.
- Review upload limits and database access permissions before deployment.

## Project structure

```text
app.js                 Express and Socket.IO entry point
config/                Passport and application configuration
controllers/           Request handlers
models/                PostgreSQL data-access models
middleware/            Authentication, locals, and upload middleware
routes/                Express route modules
scripts/               Feature migrations and seed scripts
utils/                 Database and document helpers
validators/            Express-validator rules
views/                 EJS pages and shared partials
public/                CSS, generated assets, and browser vendor assets
```

## License

This project currently uses the ISC license declared in `package.json`.
