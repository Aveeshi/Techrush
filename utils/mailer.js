const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/*
  Sends via the Brevo (formerly Sendinblue) HTTP API instead of raw SMTP.
  Every "you're registered" email goes through sendRegistrationEmail()
  below; nothing else in the app should call this API directly, so
  there's exactly one place that knows how mail actually gets sent.

  Sending is always best-effort: a failed email must never fail the
  registration itself (see call sites in eventController.js/
  subEventController.js, which fire-and-forget with .catch(console.error)
  rather than awaiting inline in the request's success path).

  Why HTTP instead of SMTP (nodemailer + smtp.gmail.com): Render either
  blocks outbound SMTP or Gmail blackholes connections from Render's IP
  range — every raw-SMTP attempt (port 465, port 587, forcing IPv4)
  timed out identically, which only outbound-SMTP-level blocking
  explains. Brevo's API is a plain HTTPS POST — port 443, same as any
  other API call this app already makes (Cloudinary, etc.) — so it isn't
  subject to that class of block.

  Why Brevo over Resend specifically: Resend requires a verified DNS
  domain before it'll deliver to anyone but your own signup address —
  fine if you own a domain, a dead end if you don't. Brevo instead
  verifies a single sender EMAIL ADDRESS (click a confirmation link,
  no DNS needed), which works with a plain Gmail address.

  Setup required before this works in production, neither of which this
  code can do for you:
    - BREVO_API_KEY env var — get one at brevo.com (Settings → SMTP &
      API → API Keys). Free tier: 300 emails/day.
    - Verify a sender address in Brevo's dashboard (Senders, Domains &
      Dedicated IPs → Senders → Add a Sender) — use the same address as
      EMAIL_USER for the simplest setup (Brevo emails that address a
      confirmation link; click it once). BREVO_SENDER_EMAIL below falls
      back to EMAIL_USER so no extra env var is needed if you do that.
      BREVO_SENDER_NAME is just the display name recipients see.
*/
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Clubbing';

// qrDataUrl (optional) — the same data:image/png;base64,... string
// QRCode.toDataURL() already produces for attendee registrations, only
// present when registrationType === 'attendee' (volunteers never get a
// QR — see EventRegistration.create). Inlined directly as a data URI in
// the HTML (renders in virtually every webmail/mobile client, including
// Gmail) and also attached as a downloadable PNG for clients that strip
// data URIs.
async function sendRegistrationEmail({ to, studentName, title, startTime, venue, registrationType, qrDataUrl }) {
  const when = new Date(startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const roleText = registrationType === 'volunteer' ? 'a volunteer' : 'an attendee';

  const attachment = [];
  let qrHtml = '';
  if (qrDataUrl) {
    const base64 = qrDataUrl.split(',')[1];
    attachment.push({ name: 'qr-code.png', content: base64 });
    qrHtml = `
      <p>Show this QR code at the entrance to check in:</p>
      <img src="${qrDataUrl}" alt="Your check-in QR code" width="200" height="200" />
    `;
  }

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: to, name: studentName }],
      subject: `You're registered: ${title}`,
      htmlContent: `
        <p>Hi ${studentName},</p>
        <p>You're registered as ${roleText} for <strong>${title}</strong>.</p>
        <p><strong>When:</strong> ${when}<br/>
           <strong>Where:</strong> ${venue || 'TBA'}</p>
        ${qrHtml}
        <p>See you there!</p>
      `,
      attachment,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API error ${res.status}: ${body}`);
  }
}

module.exports = { sendRegistrationEmail };
