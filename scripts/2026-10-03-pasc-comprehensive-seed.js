const pool = require('../utils/db');
const bcrypt = require('bcryptjs');

async function seedPASC() {
  console.log('Seeding all 13 official PASC activities and 15 coordinators from curriculum PDF...');
  
  const pascClubId = 'c3419baf-8c69-42a1-bf0e-3f0f22da7752';
  const hashedPassword = await bcrypt.hash('admin123', 10);

  // 1. Update Club Information
  await pool.query(
    `UPDATE clubs 
     SET name = 'ACM Student Chapter (PASC)',
         description = 'PICT ACM Student Chapter (PASC), a student chapter organization subsidiary of the Association for Computing Machinery (ACM), consists of highly motivated students, ready to learn and help each other bring the best out of them. PASC began in 2011, with the perspective of fostering technical and non-technical qualities in an individual and helping them to shape their future.'
     WHERE id = $1`,
    [pascClubId]
  );
  console.log('✓ Updated club name & description to PASC');

  // 2. Ensure Faculty Coordinator Dr. G.V. Kale & fc.acm@pict.edu
  await pool.query(
    `DELETE FROM faculty_coordinators WHERE club_id = $1`,
    [pascClubId]
  );

  const fcRes = await pool.query(
    `INSERT INTO faculty_coordinators (club_id, name, email, password_hash, department, designation, phone)
     VALUES 
     ($1, 'Dr. G. V. Kale', 'gvkale@pict.edu', $2, 'Computer Engineering (CE)', 'Activity In-charge (Faculty Convener)', '020-24371101'),
     ($1, 'Dr. G. V. Kale', 'fc.acm@pict.edu', $2, 'Computer Engineering (CE)', 'Activity In-charge (Faculty Convener)', '020-24371101')
     RETURNING id`,
    [pascClubId, hashedPassword]
  );
  const fcId = fcRes.rows[0].id;
  console.log('✓ Inserted Faculty Coordinator Dr. G.V. Kale (ID: ' + fcId + ')');

  // 3. Insert 15 Student Coordinators from official curriculum PDF
  const coordinators = [
    { name: 'Aditya More', roll: '41151', dept: 'CE', class_div: 'BE 1', role: 'Chairperson', email: 'aditya.more@pict.edu' },
    { name: 'Aditi Date', roll: '41316', dept: 'CE', class_div: 'BE 3', role: 'Vice Chairperson', email: 'aditi.date@pict.edu' },
    { name: 'Pritika Rohera', roll: '41360', dept: 'CE', class_div: 'BE 3', role: 'Secretary', email: 'pritika.rohera@pict.edu' },
    { name: 'Charul Nampalliwar', roll: '41452', dept: 'CE', class_div: 'BE 4', role: 'Treasurer', email: 'charul.nampalliwar@pict.edu' },
    { name: 'Pranav Jaju', roll: '41160', dept: 'CE', class_div: 'BE 1', role: 'Technical Head', email: 'pranav.jaju@pict.edu' },
    { name: 'Mustafa Trunkwala', roll: '41375', dept: 'CE', class_div: 'BE 3', role: 'Technical Head', email: 'mustafa.trunkwala@pict.edu' },
    { name: 'Rohit Kuvar', roll: '41435', dept: 'CE', class_div: 'BE 4', role: 'Public Relations Officer', email: 'rohit.kuvar@pict.edu' },
    { name: 'Om Lachure', roll: '42435', dept: 'ENTC', class_div: 'BE 8', role: 'Marketing Head', email: 'om.lachure@pict.edu' },
    { name: 'Ayush Bulbule', roll: '41409', dept: 'CE', class_div: 'BE 4', role: 'Domain Director (Web & DevOps)', email: 'ayush.bulbule@pict.edu' },
    { name: 'Aniket Kolte', roll: '41340', dept: 'CE', class_div: 'BE 3', role: 'Domain Director (Competitive Programming)', email: 'aniket.kolte@pict.edu' },
    { name: 'Awadhoot Khutwad', roll: '41239', dept: 'CE', class_div: 'BE 2', role: 'Domain Director (Android)', email: 'awadhoot.khutwad@pict.edu' },
    { name: 'Atharva Date', roll: '41216', dept: 'CE', class_div: 'BE 2', role: 'Domain Director (ML & AI)', email: 'atharva.date@pict.edu' },
    { name: 'Soumya Garg', roll: '41224', dept: 'CE', class_div: 'BE 2', role: 'Internal Engagement Officer', email: 'soumya.garg@pict.edu' },
    { name: 'Mikhiel Benji', roll: '43115', dept: 'IT', class_div: 'BE 9', role: 'Creative Head', email: 'mikhiel.benji@pict.edu' },
    { name: 'Shraddha Asolkar', roll: '43108', dept: 'IT', class_div: 'BE 9', role: 'Creative Head', email: 'shraddha.asolkar@pict.edu' }
  ];

  await pool.query(`DELETE FROM student_coordinators WHERE club_id = $1`, [pascClubId]);

  const coordinatorStudentIds = [];
  for (const c of coordinators) {
    let studentId;
    const existing = await pool.query(`SELECT id FROM students WHERE email = $1`, [c.email]);
    if (existing.rows.length > 0) {
      studentId = existing.rows[0].id;
      await pool.query(
        `UPDATE students SET name = $1, roll_number = $2, department = $3, year = 4, priority_club_id = $4 WHERE id = $5`,
        [c.name, c.roll, c.dept, pascClubId, studentId]
      );
    } else {
      const ins = await pool.query(
        `INSERT INTO students (name, email, password_hash, roll_number, department, year, priority_club_id)
         VALUES ($1, $2, $3, $4, $5, 4, $6) RETURNING id`,
        [c.name, c.email, hashedPassword, c.roll, c.dept, pascClubId]
      );
      studentId = ins.rows[0].id;
    }
    coordinatorStudentIds.push(studentId);

    // Add to club members
    await pool.query(
      `INSERT INTO club_members (club_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [pascClubId, studentId]
    );

    // Appoint as coordinator with inspection authority for leaders
    const canInspect = c.role.includes('Chairperson') || c.role.includes('Technical Head') || c.role.includes('Director');
    await pool.query(
      `INSERT INTO student_coordinators (club_id, student_id, role_title, can_inspect_records)
       VALUES ($1, $2, $3, $4)`,
      [pascClubId, studentId, c.role, canInspect]
    );
  }
  console.log(`✓ Inserted ${coordinators.length} official PASC student coordinators from PDF`);

  // 4. Ensure current demo student has PASC as priority club
  const demoStudentRes = await pool.query(`SELECT id FROM students WHERE email = 'vedantkalambe12@gmail.com' LIMIT 1`);
  let demoStudentId = demoStudentRes.rows[0] ? demoStudentRes.rows[0].id : null;
  if (!demoStudentId) {
    const firstStudent = await pool.query(`SELECT id FROM students ORDER BY created_at ASC LIMIT 1`);
    demoStudentId = firstStudent.rows[0]?.id;
  }
  if (demoStudentId) {
    await pool.query(
      `UPDATE students SET priority_club_id = $1, roll_number = COALESCE(roll_number, '41125'), department = 'CE', year = 2 WHERE id = $2`,
      [pascClubId, demoStudentId]
    );
    await pool.query(
      `INSERT INTO club_members (club_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [pascClubId, demoStudentId]
    );
  }

  // 5. Seed ALL 13 Official PASC Activities & Events from Curriculum PDF
  const events = [
    {
      title: 'Writing Code Effectively with GenAI Tools - Industry Visit at Persistent Systems',
      desc: 'Hands-on session and industry visit at Persistent Systems to understand how to effectively utilize GenAI tools to write optimized code, track strengths and weaknesses, and adapt to modern AI workflows.',
      venue: 'Persistent Systems Campus, Hinjawadi',
      hours: 5.0,
      daysAgo: 45,
      status: 'approved'
    },
    {
      title: 'LinkedIn Mastery & Professional Networking',
      desc: 'Session designed to introduce fundamentals of LinkedIn: profile optimization, networking strategies, and leveraging recommendations for career growth and maximum visibility.',
      venue: 'Auditorium A, PICT Campus',
      hours: 4.0,
      daysAgo: 38,
      status: 'approved'
    },
    {
      title: 'Eminent Speaker Program: Leadership in High-Scale Systems',
      desc: 'Exclusive session where a distinguished industry speaker shares key career learnings, challenges in high-scale distributed systems, and professional guidance for young engineers.',
      venue: 'F-Building Seminar Hall',
      hours: 4.0,
      daysAgo: 30,
      status: 'approved'
    },
    {
      title: 'Git & GitHub Special Interest Group (SIG)',
      desc: 'Hands-on workshop introducing version control: branching strategies, resolving merge conflicts, collaborative pull request workflows, and GitHub Actions CI/CD.',
      venue: 'Lab A1-305, PICT',
      hours: 6.0,
      daysAgo: 24,
      status: 'approved'
    },
    {
      title: 'Riveting Seminar with PASC: Trending Tech in 2026',
      desc: 'Engaging and insightful panel discussion on trending frontiers in engineering, featuring experts from academia and industry followed by an interactive Q&A session.',
      venue: 'Main Auditorium, PICT',
      hours: 3.0,
      daysAgo: 16,
      status: 'approved'
    },
    {
      title: 'Web Development SIG: Full-Stack React & Node',
      desc: 'Foundational and advanced full-stack concepts through interactive hands-on coding, API design, component state architecture, and regular coding quizzes.',
      venue: 'Innovation Lab, PICT',
      hours: 8.0,
      daysAgo: 10,
      status: 'approved'
    },
    {
      title: 'First Year Ideathon: Solutions for Campus & Society',
      desc: 'Hands-on sprint encouraging innovation and problem solving. Teams work on real-world problem statements, build creative prototypes, and present to judging panels.',
      venue: 'Central Incubation Center, PICT',
      hours: 10.0,
      daysAgo: 5,
      status: 'approved'
    },
    {
      title: 'Distinguished Speaker Session: Future of Autonomous AI',
      desc: 'Nurturing effective communication, confidence, and leadership qualities through structured activities, debates, impromptu speaking, and industry insights.',
      venue: 'A2 Auditorium, PICT',
      hours: 4.0,
      daysAgo: 2,
      status: 'approved'
    },
    {
      title: 'VidSync - Video Editing SIG: Creative Visual Storytelling',
      desc: 'Foundational and advanced video editing skills using industry-standard tools to produce high-quality media for technical demos and storytelling.',
      venue: 'Media Studio A1-208',
      hours: 5.0,
      daysAgo: 1,
      status: 'approved'
    },
    {
      title: 'PASC-W Session: Empowering Women in Computing & Leadership',
      desc: 'Initiative by PICT ACM Student Chapter Women focusing on empowering students through career opportunities, leadership development, mentorship, and hands-on coding.',
      venue: 'Auditorium A, PICT Campus',
      hours: 4.0,
      daysAhead: 4,
      status: 'approved'
    },
    {
      title: 'Crack Internships with PASC: DSA & Mock Interviews',
      desc: 'Comprehensive initiative guiding students through tech recruitment: ATS-friendly resume building, technical DSA problem solving, and 1-on-1 mock interviews.',
      venue: 'Tech Hub 02, PICT',
      hours: 6.0,
      daysAhead: 7,
      status: 'pending' // Awaiting sanction on Faculty Review Desk
    },
    {
      title: 'Guide to Open Source & GSoC Roadmap',
      desc: 'Discovering open-source contributions, identifying beginner-friendly repositories, understanding licensing, and preparing applications for GSoC and Outreachy.',
      venue: 'Lab A1-201, PICT',
      hours: 5.0,
      daysAhead: 12,
      status: 'pending' // Awaiting sanction on Faculty Review Desk
    },
    {
      title: 'Skill Up - Soft Skills Development Session',
      desc: 'Enhancing essential non-technical skills including verbal and written communication, public speaking, teamwork, emotional intelligence, and interview presentation.',
      venue: 'F-Building Seminar Hall',
      hours: 4.0,
      daysAhead: 18,
      status: 'pending' // Awaiting sanction on Faculty Review Desk
    }
  ];

  // Clean old events for PASC
  await pool.query(`DELETE FROM event_registrations WHERE event_id IN (SELECT id FROM events WHERE club_id = $1)`, [pascClubId]);
  await pool.query(`DELETE FROM events WHERE club_id = $1`, [pascClubId]);

  const organizerRes = await pool.query(`SELECT id FROM organizers LIMIT 1`);
  const orgId = organizerRes.rows[0] ? organizerRes.rows[0].id : null;

  for (const e of events) {
    const now = new Date();
    let eventDate;
    if (e.daysAgo) {
      eventDate = new Date(now.getTime() - e.daysAgo * 24 * 60 * 60 * 1000);
    } else {
      eventDate = new Date(now.getTime() + (e.daysAhead || 7) * 24 * 60 * 60 * 1000);
    }

    const insEv = await pool.query(
      `INSERT INTO events (club_id, organizer_id, title, description, venue, start_time, end_time, credit_hours, approval_status, approved_by_fc, verified_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'published')
       RETURNING id`,
      [
        pascClubId,
        orgId,
        e.title,
        e.desc,
        e.venue,
        eventDate,
        new Date(eventDate.getTime() + 4 * 3600 * 1000),
        e.hours,
        e.status,
        e.status === 'approved' ? fcId : null,
        e.status === 'approved' ? eventDate : null
      ]
    );

    const eventId = insEv.rows[0].id;

    // For past approved events, register and check in demo student and coordinators!
    if (e.status === 'approved') {
      if (demoStudentId) {
        await pool.query(
          `INSERT INTO event_registrations (event_id, student_id, registration_type, checked_in_at, status)
           VALUES ($1, $2, 'attendee', $3, 'checked_in') ON CONFLICT DO NOTHING`,
          [eventId, demoStudentId, eventDate]
        );
      }

      // Check in 8 coordinators as well so event attendance rosters have authentic names, rolls, and departments
      for (let i = 0; i < Math.min(8, coordinatorStudentIds.length); i++) {
        await pool.query(
          `INSERT INTO event_registrations (event_id, student_id, registration_type, checked_in_at, status)
           VALUES ($1, $2, 'attendee', $3, 'checked_in') ON CONFLICT DO NOTHING`,
          [eventId, coordinatorStudentIds[i], eventDate]
        );
      }
    }
  }

  console.log(`✓ Inserted ${events.length} PASC official activities with authentic attendees from curriculum PDF`);
  console.log('✅ PASC data seeding completed successfully!');
  process.exit(0);
}

seedPASC().catch(e => {
  console.error('Error seeding PASC data:', e);
  process.exit(1);
});
