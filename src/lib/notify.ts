import { type Booking, getSettings } from './db';

const TOPIC = process.env.NTFY_TOPIC;

// ntfy carries the title/tags in HTTP headers, which must be latin-1 safe.
const headerSafe = (s: string) => s.replace(/[^\x20-\x7E]/g, '').slice(0, 120);

/**
 * Best-effort push via ntfy. Never throws and never blocks the caller's
 * response — a failed notification must not fail the request that triggered it.
 * Gated by the master "Notifications enabled" switch in Settings.
 */
export async function notify(title: string, message: string, opts?: { tags?: string; priority?: string }): Promise<void> {
  if (!TOPIC) return; // not configured — silently no-op
  try {
    const settings = await getSettings();
    if (!settings.notificationsEnabled) return;
  } catch { /* settings lookup failed — fail open so a DB hiccup doesn't silently swallow every push */ }
  try {
    await fetch(`https://ntfy.sh/${TOPIC}`, {
      method: 'POST',
      headers: {
        Title: headerSafe(title),
        ...(opts?.tags ? { Tags: headerSafe(opts.tags) } : {}),
        ...(opts?.priority ? { Priority: opts.priority } : {}),
      },
      body: message,
    });
  } catch {
    // swallow — notifications are advisory
  }
}

const STATUS_TAG: Record<string, string> = {
  pending: 'hourglass',
  quoted: 'moneybag',
  confirmed: 'white_check_mark',
  completed: 'tada',
  cancelled: 'x',
};

/** Fired whenever a job's status changes, from admin or a guest. */
export async function notifyStatusChange(
  booking: Booking,
  from: string,
  to: string,
  actor: string,
): Promise<void> {
  if (!(await getSettings()).notifyStatusChange) return;
  const where = [booking.address, booking.suburb].filter(Boolean).join(', ');
  const lines = [
    `${booking.name}${booking.phone ? ` · ${booking.phone}` : ''}`,
    where ? `Address: ${where}` : '',
    booking.preferredDate ? `Scheduled: ${[booking.preferredDate, booking.preferredTime].filter(Boolean).join(' ')}` : '',
    typeof booking.quoteAmount === 'number' && booking.quoteAmount > 0 ? `Quote: $${booking.quoteAmount}` : '',
    `Status: ${from} -> ${to}`,
    `Changed by: ${actor}`,
  ].filter(Boolean);

  await notify(
    `Job ${to}: ${booking.name}`,
    lines.join('\n'),
    { tags: STATUS_TAG[to] ?? 'bell' },
  );
}

/** Fired when a customer taps "I've paid" on their invoice — a claim, not a confirmed payment. */
export async function notifyCustomerMarkedPaid(booking: Booking, invoiceNumber: string): Promise<void> {
  if (!(await getSettings()).notifyCustomerMarkedPaid) return;
  await notify(
    `Customer marked ${invoiceNumber} as paid`,
    `${booking.name}${booking.phone ? ` · ${booking.phone}` : ''}\nCheck the bank before marking this booking paid.`,
    { tags: 'moneybag', priority: 'high' },
  );
}

/** Fired when a job is assigned (sent) to a guest. */
export async function notifyJobAssigned(booking: Booking, guestName: string): Promise<void> {
  if (!(await getSettings()).notifyJobAssigned) return;
  const where = [booking.address, booking.suburb].filter(Boolean).join(', ');
  await notify(
    `Job sent to ${guestName}`,
    [
      `${booking.name}${booking.phone ? ` · ${booking.phone}` : ''}`,
      where ? `Address: ${where}` : '',
      booking.preferredDate ? `Scheduled: ${[booking.preferredDate, booking.preferredTime].filter(Boolean).join(' ')}` : '',
    ].filter(Boolean).join('\n'),
    { tags: 'outbox_tray' },
  );
}

/** Fired when Square's webhook confirms a card payment completed — a claim to verify, not a confirmed bank deposit. */
export async function notifySquarePaid(invoiceNumber: string): Promise<void> {
  if (!(await getSettings()).notifySquarePaid) return;
  await notify(
    `Square: ${invoiceNumber} paid by card`,
    `Card payment completed via Square. Verify it's in the account, then mark ${invoiceNumber} paid.`,
    { tags: 'credit_card', priority: 'high' },
  );
}
