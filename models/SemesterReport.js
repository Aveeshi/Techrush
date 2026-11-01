const pool = require('../utils/db');

class SemesterReport {
  static async submitOrUpdate({ studentId, clubId, academicYear, semester, totalHours, reportData }) {
    const { rows } = await pool.query(
      `INSERT INTO semester_reports (student_id, club_id, academic_year, semester, total_hours, report_data, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', now())
       ON CONFLICT (student_id, club_id, academic_year, semester)
       DO UPDATE SET total_hours = EXCLUDED.total_hours,
                     report_data = EXCLUDED.report_data,
                     status = 'pending',
                     fc_remarks = NULL,
                     submitted_at = now(),
                     verified_at = NULL,
                     verified_by = NULL
       RETURNING *`,
      [studentId, clubId, academicYear, semester, totalHours, JSON.stringify(reportData)]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT sr.*,
              s.name AS student_name, s.email AS student_email, s.roll_number,
              s.department, s.year AS student_year, s.phone,
              c.name AS club_name, c.logo_url AS club_logo,
              fc.name AS verified_by_name
       FROM semester_reports sr
       JOIN students s ON s.id = sr.student_id
       JOIN clubs c ON c.id = sr.club_id
       LEFT JOIN faculty_coordinators fc ON fc.id = sr.verified_by
       WHERE sr.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByStudent(studentId) {
    const { rows } = await pool.query(
      `SELECT sr.*, c.name AS club_name, c.logo_url AS club_logo,
              fc.name AS verified_by_name
       FROM semester_reports sr
       JOIN clubs c ON c.id = sr.club_id
       LEFT JOIN faculty_coordinators fc ON fc.id = sr.verified_by
       WHERE sr.student_id = $1
       ORDER BY sr.academic_year DESC, sr.semester DESC`,
      [studentId]
    );
    return rows;
  }

  static async findByClub(clubId, statusFilter = null) {
    let query = `
      SELECT sr.*,
             s.name AS student_name, s.email AS student_email, s.roll_number,
             s.department, s.year AS student_year,
             c.name AS club_name
      FROM semester_reports sr
      JOIN students s ON s.id = sr.student_id
      JOIN clubs c ON c.id = sr.club_id
      WHERE sr.club_id = $1
    `;
    const params = [clubId];
    if (statusFilter && ['pending', 'approved', 'rejected', 'reverification'].includes(statusFilter)) {
      query += ` AND sr.status = $2`;
      params.push(statusFilter);
    }
    query += ` ORDER BY sr.submitted_at DESC`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  static async updateStatus(id, { status, fcRemarks, verifiedBy }) {
    const { rows } = await pool.query(
      `UPDATE semester_reports
       SET status = $2,
           fc_remarks = $3,
           verified_by = $4,
           verified_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status, fcRemarks || null, verifiedBy]
    );
    return rows[0] || null;
  }

  // Cumulative 4-Year Graduation Summary for a student
  static async getCumulativeGraduationSummary(studentId) {
    const studentRes = await pool.query(
      `SELECT s.*, c.name AS priority_club_name
       FROM students s
       LEFT JOIN clubs c ON c.id = s.priority_club_id
       WHERE s.id = $1`,
      [studentId]
    );
    if (!studentRes.rows[0]) return null;
    const student = studentRes.rows[0];

    // All attended events across entire 4 years
    const eventsRes = await pool.query(
      `SELECT er.id, er.checked_in_at, er.registration_type,
              COALESCE(e.title, se.title) AS title,
              COALESCE(e.credit_hours, se.credit_hours, 0) AS credit_hours,
              COALESCE(e.venue, se.venue, 'Campus') AS venue,
              COALESCE(e.start_time, se.start_time) AS event_date,
              c.id AS club_id, c.name AS club_name
       FROM event_registrations er
       LEFT JOIN events e ON e.id = er.event_id
       LEFT JOIN sub_events se ON se.id = er.sub_event_id
       LEFT JOIN events pe ON pe.id = se.event_id
       JOIN clubs c ON c.id = COALESCE(e.club_id, pe.club_id)
       WHERE er.student_id = $1
         AND er.checked_in_at IS NOT NULL
       ORDER BY event_date ASC`,
      [studentId]
    );

    // All leadership roles (Team Head, Event Head, Student Coordinator)
    const rolesRes = await pool.query(
      `SELECT 'Event Head' AS role_type, e.title AS context_name, c.name AS club_name, eh.assigned_at AS created_at
       FROM event_heads eh
       JOIN events e ON e.id = eh.event_id
       JOIN clubs c ON c.id = e.club_id
       WHERE eh.student_id = $1

       UNION ALL

       SELECT 'Student Coordinator' AS role_type, sc.role_title AS context_name, c.name AS club_name, sc.created_at
       FROM student_coordinators sc
       JOIN clubs c ON c.id = sc.club_id
       WHERE sc.student_id = $1

       ORDER BY created_at ASC`,
      [studentId]
    );

    // Total hours calculated
    let totalHours = 0;
    const clubBreakdown = {};
    for (const ev of eventsRes.rows) {
      const h = Number(ev.credit_hours) || 0;
      totalHours += h;
      clubBreakdown[ev.club_name] = (clubBreakdown[ev.club_name] || 0) + h;
    }

    return {
      student,
      events: eventsRes.rows,
      roles: rolesRes.rows,
      totalHours,
      clubBreakdown,
    };
  }

  // Yearly Summary (Memory Dossier) for a specific academic year
  static async getYearlyMemorySummary(studentId, academicYear = null) {
    const summary = await this.getCumulativeGraduationSummary(studentId);
    if (!summary) return null;

    let filteredEvents = summary.events;
    if (academicYear) {
      filteredEvents = summary.events.filter((e) => {
        if (!e.event_date) return false;
        const d = new Date(e.event_date);
        const y = d.getFullYear();
        const m = d.getMonth() + 1; // 1-12
        // Academic year spans June/July to May/June
        const startY = parseInt(academicYear.split('-')[0], 10);
        const endY = parseInt(academicYear.split('-')[1] || startY + 1, 10);
        return (y === startY && m >= 6) || (y === endY && m <= 5);
      });
    }

    let yearHours = 0;
    for (const ev of filteredEvents) {
      yearHours += Number(ev.credit_hours) || 0;
    }

    return {
      student: summary.student,
      academicYear: academicYear || 'All Years',
      events: filteredEvents,
      yearHours,
    };
  }
}

module.exports = SemesterReport;
