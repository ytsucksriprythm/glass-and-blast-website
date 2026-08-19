import { NextRequest, NextResponse } from 'next/server';
import { addBooking, getBookingByExternalLeadId, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { sendBookingNotifications } from '@/lib/notifications';
import { listSheetTabs, fetchSheetRows } from '@/lib/googleSheets';
import { mapSheetRowToBooking } from '@/lib/metaLeads';

export const dynamic = 'force-dynamic';

// Polls every tab of the Google Sheet that Meta's built-in Lead Ads →
// Google Sheets CRM connector writes to (Ads Manager → Instant Forms →
// Connect CRM) — one tab per lead form you're running — turning any row
// not already imported into a booking (source: 'facebook-lead-ad'). Tabs
// are discovered live, so trialing a new form (a new tab) needs no config
// change here. See vercel.json for the schedule.
// Auth: Vercel's cron sends `Authorization: Bearer ${CRON_SECRET}` (same
// secret as /api/cron/recurring); a `?secret=` query param works too, for
// pinging from an external scheduler if once/day (Vercel Hobby's cron limit)
// isn't fast enough; an admin session also works so Settings can offer a
// manual "Sync now" button.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization');
  const querySecret = new URL(req.url).searchParams.get('secret');
  const cronOk = !!secret && (bearer === `Bearer ${secret}` || querySecret === secret);
  const adminOk = await isAdminAuthenticated();
  if (!cronOk && !adminOk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const spreadsheetId = process.env.META_LEADS_SHEET_ID;
  if (!spreadsheetId) return NextResponse.json({ error: 'META_LEADS_SHEET_ID not configured' }, { status: 501 });

  let tabs: string[];
  try {
    tabs = await listSheetTabs(spreadsheetId);
  } catch (err) {
    console.error('Meta leads sheet sync: could not list tabs', err);
    return NextResponse.json({ error: 'Sheet read failed' }, { status: 502 });
  }

  const created: { id: string; name: string; form: string }[] = [];
  let checked = 0;

  for (const tab of tabs) {
    let rows: string[][];
    try {
      rows = await fetchSheetRows(spreadsheetId, tab, process.env.META_LEADS_SHEET_RANGE || 'A:Z');
    } catch (err) {
      console.error(`Meta leads sheet sync: read failed for tab "${tab}"`, err);
      continue; // one broken tab shouldn't stop the others
    }
    if (rows.length < 2) continue;

    const [headerRow, ...dataRows] = rows;
    for (const row of dataRows) {
      if (!row.some(cell => cell && cell.trim())) continue; // skip blank rows
      checked++;
      try {
        const mapped = mapSheetRowToBooking(headerRow, row, tab);
        if (await getBookingByExternalLeadId(mapped.externalLeadId)) continue; // already imported

        const booking = await addBooking({ ...mapped, source: 'facebook-lead-ad', status: 'pending' });
        created.push({ id: booking.id, name: booking.name, form: tab });

        sendBookingNotifications(booking).catch(console.error);
        logActivity('booking.created', `${booking.name} — Facebook lead ad (${booking.service})`, { bookingId: booking.id }, 'customer').catch(() => {});
      } catch (err) {
        // One bad row shouldn't stop the rest of the sheet from importing.
        console.error(`Meta leads sheet sync: row failed in tab "${tab}"`, err);
      }
    }
  }

  return NextResponse.json({ imported: created.length, checked, tabs, bookings: created });
}
