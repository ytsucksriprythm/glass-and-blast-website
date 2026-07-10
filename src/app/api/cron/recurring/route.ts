import { NextRequest, NextResponse } from 'next/server';
import { runRecurringDue } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Daily Vercel cron (see vercel.json). Creates a booking for every active plan
// whose next visit has come due, then advances its date one cycle.
// Auth: Vercel's cron sends `Authorization: Bearer ${CRON_SECRET}`; an admin
// session also works so the button in the dashboard can trigger it manually.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization');
  const cronOk = !!secret && bearer === `Bearer ${secret}`;
  const adminOk = await isAdminAuthenticated();
  if (!cronOk && !adminOk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const created = await runRecurringDue();

    // One ntfy push summarising the run (only when something was created)
    if (created.length && process.env.NTFY_TOPIC) {
      const lines = created.map(c => `${c.booking.name} · ${c.booking.suburb || 'Canberra'} · ${c.booking.preferredDate}`).join('\n');
      await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
        method: 'POST',
        body: lines,
        headers: {
          Title: `${created.length} recurring job${created.length > 1 ? 's' : ''} booked in`,
          Tags: 'repeat,calendar',
          Click: `${process.env.NEXT_PUBLIC_URL ?? 'https://glassandblast.com.au'}/admin/dashboard`,
        },
      }).catch(err => console.error('Push (ntfy) failed:', err));
    }

    return NextResponse.json({ created: created.length, bookings: created.map(c => c.booking.id) });
  } catch (err) {
    console.error('Recurring cron error:', err);
    return NextResponse.json({ error: 'Cron run failed' }, { status: 500 });
  }
}
