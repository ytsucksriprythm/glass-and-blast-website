// Australia/Sydney date handling for the MCP tools. Date-range filters take
// plain local dates (YYYY-MM-DD) and are converted to UTC instants by
// Postgres itself (`(date)::timestamp AT TIME ZONE 'Australia/Sydney'`), so
// daylight saving transitions are handled by the tz database, not by us.
// Output timestamps stay ISO-8601 UTC (what's stored) with a Sydney rendering
// added alongside where a human-readable local time matters.

export const TZ = 'Australia/Sydney';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// SQL expression for "start of local day <placeholder> in Sydney" as a
// timestamptz, e.g. sydneyDayStartSql('$3').
export function sydneyDayStartSql(placeholder: string): string {
  return `((${placeholder}::date)::timestamp AT TIME ZONE '${TZ}')`;
}
// Exclusive end: start of the following local day.
export function sydneyDayEndSql(placeholder: string): string {
  return `(((${placeholder}::date) + 1)::timestamp AT TIME ZONE '${TZ}')`;
}

const partsFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hour12: false, weekday: 'long', timeZoneName: 'shortOffset',
});

export interface SydneyTime {
  date: string;      // YYYY-MM-DD local
  time: string;      // HH:MM local, 24h
  weekday: string;
  utcOffset: string; // e.g. +11:00 (AEDT) or +10:00 (AEST)
  label: string;     // "Tuesday 2026-10-06 09:00 (AEDT, UTC+11:00)"
}

export function toSydney(iso: string | null | undefined): SydneyTime | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(d)) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour;
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(p.timeZoneName ?? '');
  const offH = m ? Number(m[1]) : 10;
  const offset = `${offH >= 0 ? '+' : '-'}${String(Math.abs(offH)).padStart(2, '0')}:${m?.[2] ?? '00'}`;
  const abbr = offset === '+11:00' ? 'AEDT' : offset === '+10:00' ? 'AEST' : offset;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${hour}:${p.minute}`;
  return { date, time, weekday: p.weekday, utcOffset: offset, label: `${p.weekday} ${date} ${time} (${abbr}, UTC${offset})` };
}

export function sydneyToday(): string {
  return toSydney(new Date().toISOString())!.date;
}

export function sydneyMonthKey(iso: string): string | null {
  return toSydney(iso)?.date.slice(0, 7) ?? null;
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}
