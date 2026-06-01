import nodemailer from 'nodemailer';
import type { Booking } from './db';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing',
  'pressure-washing': 'Pressure Washing',
  'both': 'Window Washing + Pressure Washing',
};

const TIME_LABELS: Record<string, string> = {
  'morning': 'Morning (8am – 12pm)',
  'afternoon': 'Afternoon (12pm – 5pm)',
  'flexible': 'Flexible',
};

// Generic SMTP — works with Brevo, Zoho, Gmail, or any provider.
// Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in env.
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// The visible sender + where customer replies go.
const EMAIL_FROM = process.env.EMAIL_FROM ?? '"Glass & Blast Window Cleaning" <info@glassandblast.com.au>';
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'info@glassandblast.com.au';

function emailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function bookingEmailHtml(booking: Booking): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0A1628 0%, #1E3A5F 100%); color: white; padding: 32px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 8px 0 0; opacity: 0.7; font-size: 14px; }
    .badge { display: inline-block; background: #38BDF8; color: #0A1628; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 12px; margin-top: 12px; }
    .body { padding: 32px; }
    .field { margin-bottom: 16px; }
    .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
    .value { font-size: 16px; color: #0f172a; margin-top: 4px; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 13px; color: #94a3b8; }
    .cta { display: inline-block; background: #0EA5E9; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🪟 Glass & Blast Window Cleaning</h1>
      <p>New Booking Request</p>
      <div class="badge">NEW BOOKING: ${booking.id}</div>
    </div>
    <div class="body">
      <div class="grid">
        <div class="field">
          <div class="label">Customer Name</div>
          <div class="value">${booking.name}</div>
        </div>
        <div class="field">
          <div class="label">Phone</div>
          <div class="value">${booking.phone}</div>
        </div>
        <div class="field">
          <div class="label">Email</div>
          <div class="value">${booking.email}</div>
        </div>
        <div class="field">
          <div class="label">Property Type</div>
          <div class="value" style="text-transform: capitalize">${booking.propertyType}</div>
        </div>
      </div>
      <hr class="divider">
      <div class="grid">
        <div class="field">
          <div class="label">Service</div>
          <div class="value">${SERVICE_LABELS[booking.service] ?? booking.service}</div>
        </div>
        <div class="field">
          <div class="label">Preferred Time</div>
          <div class="value">${TIME_LABELS[booking.preferredTime] ?? booking.preferredTime}</div>
        </div>
        <div class="field">
          <div class="label">Preferred Date</div>
          <div class="value">${booking.preferredDate}</div>
        </div>
        <div class="field">
          <div class="label">Suburb</div>
          <div class="value">${booking.suburb}, Canberra</div>
        </div>
      </div>
      <div class="field">
        <div class="label">Address</div>
        <div class="value">${booking.address}</div>
      </div>
      ${booking.notes ? `
      <div class="field">
        <div class="label">Notes</div>
        <div class="value" style="background:#f8fafc;padding:12px;border-radius:8px;font-size:14px">${booking.notes}</div>
      </div>` : ''}
      <hr class="divider">
      <p style="font-size:14px;color:#64748b;margin:0">Submitted on ${new Date(booking.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}</p>
      <a href="${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'}/admin/dashboard" class="cta">View in Admin Dashboard</a>
    </div>
    <div class="footer">Glass & Blast Window Cleaning · North Canberra · +61 466 050 834</div>
  </div>
</body>
</html>`;
}

export async function sendBookingNotifications(booking: Booking): Promise<void> {
  const emailOwners = [
    process.env.OWNER1_EMAIL ?? 'lincolnblu@icloud.com',
    process.env.OWNER2_EMAIL ?? 'wardliam232@gmail.com',
  ].filter(Boolean);

  const subject = `🪟 New Booking: ${booking.name} – ${SERVICE_LABELS[booking.service] ?? booking.service}`;
  const html = bookingEmailHtml(booking);
  const text = `New booking from ${booking.name} (${booking.phone}) for ${SERVICE_LABELS[booking.service]} on ${booking.preferredDate}. Address: ${booking.address}, ${booking.suburb}. Booking ID: ${booking.id}`;

  // Send emails to the owners
  if (emailConfigured()) {
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: emailOwners.join(', '),
        replyTo: booking.email,
        subject,
        html,
        text,
      });
    } catch (err) {
      console.error('Email send failed:', err);
    }
  } else {
    console.log('Email not configured (set SMTP_* env vars). Booking:', text);
  }

  // Push notification to phones via ntfy.sh (free) — set NTFY_TOPIC
  if (process.env.NTFY_TOPIC) {
    try {
      const adminUrl = `${process.env.NEXT_PUBLIC_URL ?? 'https://glassandblast.com.au'}/admin/dashboard`;
      await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
        method: 'POST',
        body: `${booking.name} · ${booking.phone}\n${SERVICE_LABELS[booking.service] ?? booking.service} · ${booking.suburb || 'Canberra'}\n${booking.preferredDate} ${booking.preferredTime}`,
        headers: {
          Title: 'New Glass & Blast booking',
          Priority: 'high',
          Tags: 'bell,droplet',
          Click: adminUrl,
        },
      });
    } catch (err) {
      console.error('Push (ntfy) failed:', err);
    }
  }

  // Send confirmation email to customer
  if (emailConfigured() && booking.email) {
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: booking.email,
        replyTo: EMAIL_REPLY_TO,
        subject: `Booking Confirmed – Glass & Blast Window Cleaning`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
            <h2 style="color:#0A1628">Thanks for your booking, ${booking.name.split(' ')[0]}!</h2>
            <p>We've received your request and will be in touch shortly to confirm your appointment.</p>
            <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0">
              <p style="margin:4px 0"><strong>Service:</strong> ${SERVICE_LABELS[booking.service]}</p>
              <p style="margin:4px 0"><strong>Preferred Date:</strong> ${booking.preferredDate}</p>
              <p style="margin:4px 0"><strong>Address:</strong> ${booking.address}, ${booking.suburb}</p>
              <p style="margin:4px 0"><strong>Booking ID:</strong> ${booking.id}</p>
            </div>
            <p>Questions? Call us: <a href="tel:+61466050834">+61 466 050 834</a></p>
            <p style="color:#94a3b8;font-size:13px">Glass & Blast Window Cleaning · North Canberra</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Customer confirmation email failed:', err);
    }
  }
}
