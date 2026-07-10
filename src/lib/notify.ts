import type { Booking } from './db';

const TOPIC = process.env.NTFY_TOPIC;

// ntfy carries the title/tags in HTTP headers, which must be latin-1 safe.
const headerSafe = (s: string) => s.replace(/[^\x20-\x7E]/g, '').slice(0, 120);

/**
 * Best-effort push via ntfy. Never throws and never blocks the caller's
 * response — a failed notification must not fail the request that triggered it.
 */
export async function notify(title: string, message: string, opts?: { tags?: string; priority?: string }): Promise<void> {
  if (!TOPIC) return; // not configured — silently no-op
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

/** Fired when a job is assigned (sent) to a guest. */
export async function notifyJobAssigned(booking: Booking, guestName: string): Promise<void> {
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
