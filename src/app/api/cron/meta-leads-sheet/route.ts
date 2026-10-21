import { NextRequest, NextResponse } from 'next/server';
import { addBooking, getBookingByExternalLeadId, getDismissedLeadIds, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { sendBookingNotifications } from '@/lib/notifications';
import { listSheetTabs, fetchSheetRows, writeSheetCell } from '@/lib/googleSheets';
import { mapSheetRowToBooking, findColumnIndex, normalize, siteStatusLabel, ID_COLUMN_CANDIDATES, SITE_STATUS_HEADER } from '@/lib/metaLeads';

export const dynamic = 'force-dynamic';

// Polls every tab of the Google Sheet that Meta's built-in Lead Ads →
// Google Sheets CRM connector writes to (Ads Manager → Instant Forms →
// Connect CRM) — one tab per lead form you're running — turning any row
// not already imported into a booking (source: 'facebook-lead-ad'). Tabs
// are discovered live, so trialing a new form (a new tab) needs no config
// change here. Vercel Cron runs it every minute (vercel.json, needs the Pro
// plan; Hobby only allows once a day).
// Auth: Vercel's cron sends `Authorization: Bearer ${CRON_SECRET}` (same
// secret as /api/cron/recurring); a `?secret=` query param works too, for
// pinging from an external scheduler; an admin session also works so
// Settings can offer a manual "Sync now" button.
//
// Rows already handled are marked in the sheet's "Site Status" column (the
// booking's status, or "Deleted" for a lead dismissed from the CRM) and
// skipped on later polls without touching the database. This matters: the
// route is polled around the clock, and a DB query on every ping kept the
// Neon compute from ever auto-suspending, which burned through the free
// plan's monthly compute quota and took the admin down. A poll with no new
// rows now only reads the sheet. Rows with no `id` column (hashed ids) can't
// be marked, since writing the cell would change the hash, so those still
// check the DB.
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
  let skippedDismissed = 0;
  let skippedMarked = 0;
  // Loaded only when a row actually needs a DB check, so an idle poll
  // never wakes the database.
  let dismissed: Set<string> | null = null;

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
    const hasIdCol = findColumnIndex(headerRow, ID_COLUMN_CANDIDATES) !== -1;
    let statusCol = headerRow.findIndex(h => normalize(h) === normalize(SITE_STATUS_HEADER));

    // Best effort: a failed write just means this row gets a DB check next poll.
    const mark = async (rowIdx: number, value: string) => {
      try {
        if (statusCol === -1) {
          statusCol = headerRow.length;
          await writeSheetCell(spreadsheetId, tab, 1, statusCol, SITE_STATUS_HEADER);
        }
        await writeSheetCell(spreadsheetId, tab, rowIdx + 2, statusCol, value); // header row + 1-indexing
      } catch (err) {
        console.error(`Meta leads sheet sync: could not mark row in tab "${tab}"`, err);
      }
    };

    for (const [rowIdx, row] of dataRows.entries()) {
      if (!row.some(cell => cell && cell.trim())) continue; // skip blank rows
      checked++;
      if (hasIdCol && statusCol !== -1 && (row[statusCol] ?? '').trim()) { skippedMarked++; continue; } // handled on an earlier poll
      try {
        const mapped = mapSheetRowToBooking(headerRow, row, tab);
        const canMark = !mapped.externalLeadId.startsWith('sheet:');
        dismissed ??= await getDismissedLeadIds();
        if (dismissed.has(mapped.externalLeadId)) { // deleted from CRM before — stay deleted
          skippedDismissed++;
          if (canMark) await mark(rowIdx, 'Deleted');
          continue;
        }
        const existing = await getBookingByExternalLeadId(mapped.externalLeadId);
        if (existing) { // already imported
          if (canMark) await mark(rowIdx, siteStatusLabel(existing.status));
          continue;
        }

        const booking = await addBooking({ ...mapped, source: 'facebook-lead-ad', status: 'uncontacted' });
        created.push({ id: booking.id, name: booking.name, form: tab });
        if (canMark) await mark(rowIdx, siteStatusLabel(booking.status));

        sendBookingNotifications(booking).catch(console.error);
        logActivity('booking.created', `${booking.name} · Facebook lead ad (${booking.service})`, { bookingId: booking.id }, 'customer').catch(() => {});
      } catch (err) {
        // One bad row shouldn't stop the rest of the sheet from importing.
        console.error(`Meta leads sheet sync: row failed in tab "${tab}"`, err);
      }
    }
  }

  return NextResponse.json({ imported: created.length, checked, skippedDismissed, skippedMarked, tabs, bookings: created });
}
