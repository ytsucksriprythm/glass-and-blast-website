import crypto from 'crypto';
import type { Booking, NewBooking, ServiceType } from './db';
import { stripPhonePrefix } from './db';
import { listSheetTabs, fetchSheetRows, writeSheetCell } from './googleSheets';

// ─── Field mapping ───────────────────────────────────────────────────────────
// Meta's built-in "Google Sheets" CRM connector (Ads Manager → Instant Forms
// → Connect CRM) appends one row per lead, with columns named after the
// form's questions plus a few fixed metadata columns (id, created_time,
// ad_name, form_name, ...). Column names/order/punctuation aren't
// guaranteed (e.g. "property_address_/_suburb" combines two things into
// one column), so we match by normalized header name — alphanumeric only —
// rather than position, and preserve anything we don't recognize in notes
// so nothing submitted is ever lost.
const SERVICE_KEYWORDS: [RegExp, ServiceType][] = [
  [/solar/i, 'solar-panel-cleaning'],
  [/pressure/i, 'pressure-washing'],
  [/flyscreen|fly.?screen/i, 'flyscreen-repair'],
  [/window/i, 'window-washing'],
];

export const normalize = (name: string) => (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ID_CANDIDATES = ['id', 'leadid'];
const NAME_CANDIDATES = ['fullname', 'name'];
const FIRSTNAME_CANDIDATES = ['firstname'];
const LASTNAME_CANDIDATES = ['lastname'];
const PHONE_CANDIDATES = ['phonenumber', 'phone'];
const EMAIL_CANDIDATES = ['email'];
const ADDRESS_CANDIDATES = ['streetaddress', 'address', 'propertyaddresssuburb', 'propertyaddress'];
const SUBURB_CANDIDATES = ['city', 'suburb'];
const AD_NAME_CANDIDATES = ['adname'];
const FORM_NAME_CANDIDATES = ['formname'];

export const SITE_STATUS_HEADER = 'Site Status';

// Finds a header index by exact normalized match against a candidate list,
// then (address only, since header wording varies the most there) falls
// back to a substring match so a variant like "job_address" still lands in
// the right field instead of just notes.
function findColumn(headers: string[], candidates: string[], substringFallback?: string): number {
  const normalized = headers.map(normalize);
  for (const c of candidates) {
    const idx = normalized.indexOf(c);
    if (idx !== -1) return idx;
  }
  if (substringFallback) {
    const idx = normalized.findIndex(h => h.includes(substringFallback));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function findColumnIndex(headers: string[], candidates: string[]): number {
  return findColumn(headers, candidates);
}

// Maps one sheet row (given the header row) to booking fields. Header/row
// are the same length as returned by the Sheets API for that row (a short
// row just means trailing columns were blank in the sheet). `fallbackFormName`
// is the sheet tab's title, used when the row itself has no form_name value.
export function mapSheetRowToBooking(headers: string[], row: string[], fallbackFormName?: string): Omit<NewBooking, 'source' | 'status'> & { externalLeadId: string } {
  const cells = headers.map((h, i) => ({ label: h, value: (row[i] ?? '').trim() }));
  const used = new Set<number>();

  const take = (idx: number): string => {
    if (idx === -1 || used.has(idx) || !cells[idx].value) return '';
    used.add(idx);
    return cells[idx].value;
  };

  const externalLeadId = take(findColumn(headers, ID_CANDIDATES));
  const fullName = take(findColumn(headers, NAME_CANDIDATES));
  const firstName = take(findColumn(headers, FIRSTNAME_CANDIDATES));
  const lastName = take(findColumn(headers, LASTNAME_CANDIDATES));
  const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || 'Facebook lead (no name given)';

  const phone = stripPhonePrefix(take(findColumn(headers, PHONE_CANDIDATES)));
  const email = take(findColumn(headers, EMAIL_CANDIDATES));
  const address = take(findColumn(headers, ADDRESS_CANDIDATES, 'address'));
  const suburb = take(findColumn(headers, SUBURB_CANDIDATES));
  const adName = take(findColumn(headers, AD_NAME_CANDIDATES));
  const formName = take(findColumn(headers, FORM_NAME_CANDIDATES)) || fallbackFormName || '';

  let service: ServiceType = 'other';
  cells.forEach((cell, i) => {
    if (used.has(i) || service !== 'other') return;
    const match = SERVICE_KEYWORDS.find(([re]) => re.test(cell.label) || re.test(cell.value));
    if (match) {
      service = match[1];
      used.add(i);
    }
  });
  // Answers rarely name the service (the form itself is per-service, e.g.
  // "Window Cleaning – Quote Request") — fall back to the form/tab name.
  if (service === 'other') {
    const match = SERVICE_KEYWORDS.find(([re]) => re.test(formName));
    if (match) service = match[1];
  }

  // Anything left over (custom form questions) is preserved verbatim.
  const leftover = cells.filter((cell, i) => !used.has(i) && cell.value);
  const notesParts = [
    leftover.map(cell => `${cell.label}: ${cell.value}`).join('\n'),
    formName ? `Form: ${formName}` : '',
    adName ? `Ad: ${adName}` : '',
  ].filter(Boolean);

  // No "id" column found (or it was blank) — fall back to a stable hash of
  // the row's contents so dedup still works across repeated polls. Prefixed
  // so the status-sync write-back can recognize it can't reliably find this
  // row again by id and skip trying.
  const resolvedId = externalLeadId || `sheet:${crypto.createHash('sha256').update(row.join('|')).digest('hex').slice(0, 24)}`;

  return {
    name,
    email,
    phone,
    address,
    suburb,
    service,
    propertyType: 'residential',
    preferredDate: '',
    preferredTime: '',
    notes: notesParts.join('\n'),
    attributionSource: adName ? `Facebook Ad (${adName})` : formName ? `Facebook Lead Ad (${formName})` : 'Facebook Lead Ad',
    externalLeadId: resolvedId,
  };
}

// ─── Status write-back (site → Sheet, one-way) ──────────────────────────────
// Mirrors a booking's status into a "Site Status" column in the Google Sheet
// row it was imported from — a reference copy for anyone looking at the raw
// sheet. This does NOT feed back into Meta's own lead_status column or into
// Meta's ad-delivery optimization: the Connect-CRM → Google Sheets export is
// one-way (Meta → Sheet). Closing that loop for real needs Meta's separate
// Conversions API for Lead Ads.
const BOOKING_STATUS_LABEL: Record<string, string> = {
  uncontacted: 'Uncontacted', contacted: 'Contacted', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead',
};

export async function syncBookingStatusToSheet(booking: Booking): Promise<void> {
  if (booking.source !== 'facebook-lead-ad' || !booking.externalLeadId) return;
  if (booking.externalLeadId.startsWith('sheet:')) return; // synthetic id — no id column to relocate this row by
  const spreadsheetId = process.env.META_LEADS_SHEET_ID;
  if (!spreadsheetId) return;

  const tabs = await listSheetTabs(spreadsheetId);
  for (const tab of tabs) {
    const rows = await fetchSheetRows(spreadsheetId, tab, process.env.META_LEADS_SHEET_RANGE || 'A:Z');
    if (rows.length < 2) continue;
    const [headers, ...data] = rows;

    const idCol = findColumn(headers, ID_CANDIDATES);
    if (idCol === -1) continue;
    const rowIdx = data.findIndex(r => (r[idCol] ?? '').trim() === booking.externalLeadId);
    if (rowIdx === -1) continue; // not this tab — keep looking

    let statusCol = headers.findIndex(h => normalize(h) === normalize(SITE_STATUS_HEADER));
    if (statusCol === -1) {
      statusCol = headers.length;
      await writeSheetCell(spreadsheetId, tab, 1, statusCol, SITE_STATUS_HEADER);
    }
    const sheetRow = rowIdx + 2; // header row + 1-indexing
    await writeSheetCell(spreadsheetId, tab, sheetRow, statusCol, BOOKING_STATUS_LABEL[booking.status] ?? booking.status);
    return;
  }
}
