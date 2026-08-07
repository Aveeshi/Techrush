const nodemailer = require('nodemailer');

/*
  One shared Gmail transport (App Password auth, not OAuth — simplest
  setup for a single sending account). Every "you're registered" email
  goes through sendRegistrationEmail() below; nothing else in the app
  should call nodemailer directly, so there's exactly one place that
  knows how mail actually gets sent.

  Sending is always best-effort: a failed email must never fail the
  registration itself (see call sites in eventController.js/
  subEventController.js, which fire-and-forget with .catch(console.error)
  rather than awaiting inline in the request's success path).
*/
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// qrDataUrl (optional) — the same data:image/png;base64,... string
// QRCode.toDataURL() already produces for attendee registrations, only
// present when registrationType === 'attendee' (volunteers never get a
// QR — see EventRegistration.create). Attached as an inline image via
// Content-ID so it renders directly in the email body, not just as a
// download.
async function sendRegistrationEmail({ to, studentName, title, startTime, venue, registrationType, qrDataUrl }) {
  const when = new Date(startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const roleText = registrationType === 'volunteer' ? 'a volunteer' : 'an attendee';

  const attachments = [];
  let qrHtml = '';
  if (qrDataUrl) {
    const base64 = qrDataUrl.split(',')[1];
    attachments.push({
      filename: 'qr-code.png',
      content: Buffer.from(base64, 'base64'),
      cid: 'registration-qr',
    });
    qrHtml = `
      <p>Show this QR code at the entrance to check in:</p>
      <img src="cid:registration-qr" alt="Your check-in QR code" width="200" height="200" />
    `;
  }

  await transporter.sendMail({
    from: `"Clubbing" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You're registered: ${title}`,
    html: `
      <p>Hi ${studentName},</p>
      <p>You're registered as ${roleText} for <strong>${title}</strong>.</p>
      <p><strong>When:</strong> ${when}<br/>
         <strong>Where:</strong> ${venue || 'TBA'}</p>
      ${qrHtml}
      <p>See you there!</p>
    `,
    attachments,
  });
}

module.exports = { sendRegistrationEmail };
