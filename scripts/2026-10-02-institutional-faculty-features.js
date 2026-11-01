require('dotenv').config();
const db = require('../utils/db');
const bcrypt = require('bcryptjs');

async function migrate() {
  console.log('Running Institutional Coordinator & Faculty Coordinator migration...');

  // 1. Institutional Coordinators table
  await db.query(`
    CREATE TABLE IF NOT EXISTS institutional_coordinators (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      department TEXT DEFAULT 'Central Administration',
      phone TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('institutional_coordinators table verified/created.');

  // 2. Faculty Coordinators table
  await db.query(`
    CREATE TABLE IF NOT EXISTS faculty_coordinators (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      department TEXT,
      designation TEXT DEFAULT 'Assistant Professor',
      phone TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('faculty_coordinators table verified/created.');

  // 3. Student Coordinators assignment table
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_coordinators (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      assigned_by UUID REFERENCES faculty_coordinators(id) ON DELETE SET NULL,
      role_title TEXT DEFAULT 'Student Coordinator',
      task_description TEXT,
      can_inspect_records BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (club_id, student_id)
    );
  `);
  console.log('student_coordinators table verified/created.');

  // 4. Alter students table: add priority_club_id if not present
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' AND column_name = 'priority_club_id'
      ) THEN
        ALTER TABLE students ADD COLUMN priority_club_id UUID REFERENCES clubs(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  console.log('students table priority_club_id verified/added.');

  // 5. Alter events table: add approval_status, approved_by_fc, fc_remarks
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'approval_status'
      ) THEN
        ALTER TABLE events ADD COLUMN approval_status TEXT DEFAULT 'approved';
        ALTER TABLE events ADD COLUMN approved_by_fc UUID REFERENCES faculty_coordinators(id) ON DELETE SET NULL;
        ALTER TABLE events ADD COLUMN fc_remarks TEXT;
        ALTER TABLE events ADD COLUMN verified_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);
  console.log('events table approval columns verified/added.');

  // 6. Semester Reports table for student semester report submissions & FC verification
  await db.query(`
    CREATE TABLE IF NOT EXISTS semester_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      academic_year TEXT NOT NULL,
      semester INT NOT NULL CHECK (semester BETWEEN 1 AND 8),
      total_hours NUMERIC(6,2) DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reverification')),
      fc_remarks TEXT,
      verified_by UUID REFERENCES faculty_coordinators(id) ON DELETE SET NULL,
      submitted_at TIMESTAMPTZ DEFAULT now(),
      verified_at TIMESTAMPTZ,
      report_data JSONB,
      UNIQUE(student_id, club_id, academic_year, semester)
    );
  `);
  console.log('semester_reports table verified/created.');

  // 7. Seed sample Institutional Coordinator & Faculty Coordinators if none exist
  const defaultPass = await bcrypt.hash('admin123', 10);

  // Check institutional coordinator
  const instCheck = await db.query(`SELECT id FROM institutional_coordinators LIMIT 1`);
  if (instCheck.rowCount === 0) {
    await db.query(`
      INSERT INTO institutional_coordinators (name, email, password_hash, department, phone)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'Dr. Institutional Coordinator',
      'institution@pict.edu',
      defaultPass,
      'Institutional Academic Council',
      '+91 9876543210'
    ]);
    console.log('Seeded default Institutional Coordinator: institution@pict.edu / admin123');
  }

  // Check faculty coordinators for clubs
  const clubs = await db.query(`SELECT id, name FROM clubs`);
  for (const c of clubs.rows) {
    const fcCheck = await db.query(`SELECT id FROM faculty_coordinators WHERE club_id = $1`, [c.id]);
    if (fcCheck.rowCount === 0) {
      const email = `fc.${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@pict.edu`;
      await db.query(`
        INSERT INTO faculty_coordinators (club_id, name, email, password_hash, department, designation)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO NOTHING
      `, [
        c.id,
        `Prof. ${c.name} Coordinator`,
        email,
        defaultPass,
        'Computer Engineering',
        'Faculty Club Incharge'
      ]);
      console.log(`Seeded Faculty Coordinator for ${c.name}: ${email} / admin123`);
    }
  }

  // Link existing published events to approved status
  await db.query(`UPDATE events SET approval_status = 'approved' WHERE approval_status IS NULL`);

  console.log('Migration completed successfully.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
