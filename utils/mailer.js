const nodemailer = require('nodemailer');
const dns = require('dns');

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 587;

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

  Why the transport is built fresh per send instead of once at module
  load, and why we resolve the IP ourselves:

  The installed nodemailer version's own hostname resolver (lib/shared/
  resolveHostname) fetches BOTH smtp.gmail.com's A (IPv4) and AAAA (IPv6)
  records, then picks which one to actually connect to at RANDOM
  (`addresses[Math.floor(Math.random() * addresses.length)]`) — it never
  reads a `family` option (that's not a thing this version supports,
  despite `family` being a documented net.connect option elsewhere).
  On a host with no IPv6 egress route (Render), that coin flip surfaces
  as intermittent ENETUNREACH on the IPv6 picks and timeouts on the IPv4
  picks, which looked like two different bugs but was one: nondeterministic
  address selection outside our control.

  The fix is to never hand nodemailer a hostname to resolve at all —
  resolve smtp.gmail.com to an IPv4 address ourselves via dns.resolve4,
  then pass that literal IP as `host`. nodemailer's resolver short-circuits
  immediately when `host` is already an IP (net.isIP(host) => "nothing to
  do here"), so the random picker never runs. `tls.servername` is set
  explicitly to the real hostname so TLS certificate hostname verification
  still succeeds — otherwise it'd try to match Gmail's cert against the
  bare IP and fail.

  Resolving fresh on every send (rather than caching one IP for the
  process lifetime) costs one extra DNS lookup per registration email —
  negligible — and avoids ever going stale if Gmail rotates its SMTP
  frontend IPs.
*/
async function getTransporter() {
  const [ip] = await dns.promises.resolve4(GMAIL_SMTP_HOST);
  return nodemailer.createTransport({
    host: ip,
    port: GMAIL_SMTP_PORT,
    secure: false,
    requireTLS: true,
    connectionTimeout: 15000,
    tls: { servername: GMAIL_SMTP_HOST },
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });
}

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

  const transporter = await getTransporter();
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
