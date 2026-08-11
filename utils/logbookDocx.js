const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  PageBreak, VerticalAlign, ShadingType,
} = require('docx');
const imageSize = require('image-size').imageSize;

/*
  Builds the CCA Activity Logbook .docx for one student, scoped to one
  club — this is the whole document assembly, called from
  logbookController.generate with everything it needs already fetched
  (see models/LogbookData.js for where the rows come from):

    Page 1 — static instructions, mirrors the college's standard CCA
             logbook cover sheet (course info, submission rules).
    Page 2 — student details + the Sr.No/Date/Day/Time/Hours/Activity
             table, one row per verified task AND per attended event,
             merged and sorted chronologically.
    Page 3 — a numbered "Report on Activities" section: title +
             description for every row in the table above.
    Page 4+ — every photo the student uploaded for this club, one per
              page, largest-side-capped so portrait and landscape shots
              both fit without distortion.

  Neither task_assignments nor event_registrations records a clock time
  directly, so the Date/Day/Time/Hours columns are DERIVED here:
    - task rows: end = verified_at, start = end minus hours_logged, so the
      displayed range's length always matches the credited hours exactly.
    - event rows: start = checked_in_at, end = checked_out_at (if the
      student ever checked out — otherwise the end/hours cells are left
      blank rather than guessing a duration nobody recorded).
*/

const INSTITUTE_NAME = process.env.LOGBOOK_INSTITUTE_NAME || 'Your Institute Name';
const INSTITUTE_ADDRESS = process.env.LOGBOOK_INSTITUTE_ADDRESS || '';

const FONT = 'Times New Roman';
const BODY_SIZE = 24; // 12pt, docx sizes are in half-points

function cellBorders() {
  const edge = { style: BorderStyle.SINGLE, size: 2, color: '000000' };
  return { top: edge, bottom: edge, left: edge, right: edge };
}

function textCell(text, { bold = false, align = AlignmentType.LEFT, shaded = false, width } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: cellBorders(),
    verticalAlign: VerticalAlign.CENTER,
    shading: shaded ? { type: ShadingType.CLEAR, fill: 'E8E8E8' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text: String(text ?? ''), bold, font: FONT, size: 20 })],
      }),
    ],
  });
}

function weekday(date) {
  return date.toLocaleDateString('en-IN', { weekday: 'long' });
}

function formatDate(date) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(date) {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatTimeRange(start, end) {
  if (!start) return '-';
  if (!end) return formatTime(start);
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatHours(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '-';
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hr${rounded === 1 ? '' : 's'}`;
}

// Merges verified task rows + attended event rows into one chronological
// activity list with everything the table/report pages need pre-derived.
function buildActivities(taskRows, eventRows) {
  const fromTasks = taskRows.map((r) => {
    const hours = Number(r.hours_logged) || 0;
    const end = new Date(r.timestamp);
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    return {
      date: end,
      start,
      end,
      hours,
      title: r.title,
      description: r.description || 'No description provided.',
      kind: 'Task completed',
    };
  });

  const fromEvents = eventRows.map((r) => {
    const start = new Date(r.checked_in_at);
    const end = r.checked_out_at ? new Date(r.checked_out_at) : null;
    // Hours credited is the organizer's configured credit_hours for the
    // event/sub-event (same flat award User.getCreditedHours* uses) — NOT
    // the checked_in_at→checked_out_at gap, which is null for almost every
    // attendee since events rarely run an explicit checkout scan and would
    // otherwise show as 0/blank hours despite the student having earned
    // credit for attending.
    const hours = r.credit_hours !== null && r.credit_hours !== undefined ? Number(r.credit_hours) : null;
    return {
      date: start,
      start,
      end,
      hours,
      title: r.title,
      description: r.description || 'No description provided.',
      kind: 'Event attended (Attendee)',
    };
  });

  return [...fromTasks, ...fromEvents].sort((a, b) => a.date - b.date);
}

function coverPage(club) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: INSTITUTE_NAME, bold: true, font: FONT, size: 32 })],
    }),
    ...(INSTITUTE_ADDRESS
      ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: INSTITUTE_ADDRESS, font: FONT, size: 22 })],
        })]
      : []),
    new Paragraph({ text: '', spacing: { after: 300 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Co-Curricular Activity (CCA)', bold: true, font: FONT, size: 28, underline: {} })],
    }),
    new Paragraph({ text: '', spacing: { after: 300 } }),
    new Paragraph({
      children: [new TextRun({ text: `Club / Activity: ${club.name}`, bold: true, font: FONT, size: BODY_SIZE })],
    }),
    new Paragraph({ text: '', spacing: { after: 300 } }),
    new Paragraph({
      children: [new TextRun({ text: 'Instructions for the students:', bold: true, font: FONT, size: BODY_SIZE, underline: {} })],
    }),
    new Paragraph({ text: '', spacing: { after: 150 } }),
    ...[
      'Maintain the Activity Logbook as per the format and submit it as required by your Teacher Guardian.',
      'Progress will be assessed continuously using the Activity Logbook.',
      'Credits will be awarded only after successful completion of the activity and submission of the Activity Logbook along with an activity report duly signed by the Activity Mentor and Activity In-charge.',
      'After successful completion, an Activity Report (brief description of all activities, learning outcomes, experience, achievements, photographs) is to be submitted to the Activity In-charge & Head of the Department.',
    ].map((line, i) => new Paragraph({
      spacing: { after: 150 },
      children: [new TextRun({ text: `${i + 1}) ${line}`, font: FONT, size: BODY_SIZE })],
    })),
    new Paragraph({ text: '', spacing: { after: 200 } }),
    new Paragraph({
      children: [new TextRun({ text: 'Lists of documents to be submitted by the student along with the report:', bold: true, font: FONT, size: BODY_SIZE })],
    }),
    ...[
      'Details about achievements/participation at events outside the institution.',
      'Certificate of participation in any events outside the institution / award / prize etc.',
      'Geo-tagged photographs of events participated in / conducted.',
    ].map((line) => new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: `• ${line}`, font: FONT, size: BODY_SIZE })],
    })),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function studentDetailsBlock(student, club) {
  const rows = [
    ['Name of the student', student.name],
    ['Roll Number', student.roll_number || '-'],
    ['Department', student.department || '-'],
    ['Activity / Club', club.name],
    ['Generated on', formatDate(new Date())],
  ];
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Activity Log Book', bold: true, font: FONT, size: 28, underline: {} })],
    }),
    new Paragraph({ text: '', spacing: { after: 200 } }),
    ...rows.map(([label, value]) => new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: `${label}: `, bold: true, font: FONT, size: BODY_SIZE }),
        new TextRun({ text: String(value), font: FONT, size: BODY_SIZE }),
      ],
    })),
    new Paragraph({ text: '', spacing: { after: 200 } }),
  ];
}

function activityTable(activities) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      textCell('Sr.No.', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 6 }),
      textCell('Date', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 10 }),
      textCell('Day', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 10 }),
      textCell('Time', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 14 }),
      textCell('Total Hours', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 10 }),
      textCell('Activity / Work Carried Out', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 30 }),
      textCell("Student's Signature", { bold: true, align: AlignmentType.CENTER, shaded: true, width: 10 }),
      textCell('Activity Mentor Signature', { bold: true, align: AlignmentType.CENTER, shaded: true, width: 10 }),
    ],
  });

  const bodyRows = activities.map((a, i) => new TableRow({
    children: [
      textCell(i + 1, { align: AlignmentType.CENTER }),
      textCell(formatDate(a.date), { align: AlignmentType.CENTER }),
      textCell(weekday(a.date), { align: AlignmentType.CENTER }),
      textCell(formatTimeRange(a.start, a.end), { align: AlignmentType.CENTER }),
      textCell(formatHours(a.hours), { align: AlignmentType.CENTER }),
      textCell(`${a.title} (${a.kind})`),
      textCell(''),
      textCell(''),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

function reportPage(activities) {
  if (!activities.length) {
    return [
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Report on Activities and Sessions Attended:', bold: true, font: FONT, size: 26, underline: {} })],
      }),
      new Paragraph({
        spacing: { before: 200 },
        children: [new TextRun({ text: 'No verified tasks or checked-in events on file yet for this club.', font: FONT, size: BODY_SIZE })],
      }),
    ];
  }

  const items = activities.flatMap((a, i) => [
    new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [new TextRun({ text: `${i + 1}. ${a.title} — ${a.kind}:`, bold: true, font: FONT, size: BODY_SIZE })],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 100 },
      children: [new TextRun({ text: a.description, font: FONT, size: BODY_SIZE })],
    }),
  ]);

  return [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Report on Activities and Sessions Attended:', bold: true, font: FONT, size: 26, underline: {} })],
    }),
    ...items,
  ];
}

// Fetches every uploaded photo and embeds it, one per page, scaled to fit
// within a fixed box while preserving its original aspect ratio. A photo
// that fails to download (dead URL, network hiccup) is skipped rather than
// failing the whole document — the logbook is still worth generating
// without it.
async function imagesSection(images) {
  const MAX_W = 480;
  const MAX_H = 640;

  const paragraphs = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      let width = MAX_W;
      let height = MAX_H;
      let type = 'jpg';
      try {
        const dims = imageSize(buffer);
        if (dims.width && dims.height) {
          const scale = Math.min(MAX_W / dims.width, MAX_H / dims.height, 1);
          width = Math.round(dims.width * scale);
          height = Math.round(dims.height * scale);
        }
        // docx's ImageRun needs its own type tag to match the actual bytes
        // (mismatched type corrupts the embed in Word) — map image-size's
        // detected format onto the handful docx recognizes, defaulting to
        // jpg for anything else. This is set PER IMAGE, not document-wide,
        // so a batch of mixed jpg/png/gif uploads all embed correctly
        // side by side in the same file.
        if (dims.type === 'png') type = 'png';
        else if (dims.type === 'gif') type = 'gif';
        else if (dims.type === 'bmp') type = 'bmp';
      } catch {
        // Unknown/unreadable dimensions — fall back to the fixed box + jpg above.
      }

      paragraphs.push(
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: buffer,
              transformation: { width, height },
              type,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 150 },
          children: [new TextRun({ text: `Photo ${i + 1}`, italics: true, font: FONT, size: 20 })],
        }),
      );
    } catch (err) {
      console.error(`Logbook: skipping image ${img.url} — ${err.message}`);
    }
  }
  return paragraphs;
}

async function buildLogbookDocx({ student, club, taskRows, eventRows, images }) {
  const activities = buildActivities(taskRows, eventRows);
  const imageParagraphs = await imagesSection(images);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          ...coverPage(club),
          ...studentDetailsBlock(student, club),
          activityTable(activities),
          ...reportPage(activities),
          ...imageParagraphs,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildLogbookDocx };
