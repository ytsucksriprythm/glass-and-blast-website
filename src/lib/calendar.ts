// Read-only Google Calendar feed for the admin dashboard.
// Point GOOGLE_CALENDAR_ICS_URL at your calendar's "Secret address in iCal format"
// (Google Calendar → Settings → <your calendar> → Integrate calendar). Server-side
// only, so the secret URL never reaches the browser.

const ICS_URL = process.env.GOOGLE_CALENDAR_ICS_URL;

export type Job = {
  uid: string;
  title: string;
  location: string;
  dow: string;   // 'Thu'
  day: string;   // '15'
  mon: string;   // 'Jan'
  timeLabel: string; // '9:00am' or 'All day'
  allDay: boolean;
  sortKey: number;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let cache: { ts: number; data: Job[] } | null = null;

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

// Business timezone (ACT shares Sydney's clock, including DST).
const TZ = 'Australia/Sydney';

// Format a real UTC instant in the business timezone.
function fmtZone(epoch: number) {
  // en-US gives 3-letter months (Jun) to match the all-day path; timezone still ACT.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(epoch));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const minute = get('minute');
  const ampm = get('dayPeriod').toLowerCase().includes('p') ? 'pm' : 'am';
  const timeLabel = `${get('hour')}${minute && minute !== '00' ? ':' + minute : ''}${ampm}`;
  return { dow: get('weekday'), day: get('day'), mon: get('month'), timeLabel };
}

function manualTime(H: number, Mi: number) {
  const ampm = H < 12 ? 'am' : 'pm';
  let hr = H % 12; if (hr === 0) hr = 12;
  return Mi === 0 ? `${hr}${ampm}` : `${hr}:${String(Mi).padStart(2, '0')}${ampm}`;
}

function parseDt(value: string, isDate: boolean) {
  const m = value.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const Y = +m[1], Mo = +m[2], D = +m[3];
  const H = m[4] ? +m[4] : 0;
  const Mi = m[5] ? +m[5] : 0;
  const isUtc = m[7] === 'Z';
  const allDay = isDate || !m[4];

  if (allDay) {
    const sortKey = Date.UTC(Y, Mo - 1, D);
    return { allDay: true, sortKey, dow: DOWS[new Date(sortKey).getUTCDay()], day: String(D), mon: MONTHS[Mo - 1], timeLabel: 'All day' };
  }

  if (isUtc) {
    // UTC instant — convert to local Canberra time for display + ordering.
    const epoch = Date.UTC(Y, Mo - 1, D, H, Mi);
    return { allDay: false, sortKey: epoch, ...fmtZone(epoch) };
  }

  // Floating / TZID local wall-clock — already local, show as written.
  const sortKey = Date.UTC(Y, Mo - 1, D, H, Mi);
  return { allDay: false, sortKey, dow: DOWS[new Date(Date.UTC(Y, Mo - 1, D)).getUTCDay()], day: String(D), mon: MONTHS[Mo - 1], timeLabel: manualTime(H, Mi) };
}

function parseIcs(text: string): Job[] {
  // Unfold RFC 5545 folded lines (continuation lines start with a space/tab).
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const jobs: Job[] = [];
  let cur: Record<string, unknown> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      const dt = cur?.dt as ReturnType<typeof parseDt> | undefined;
      if (cur && dt) {
        jobs.push({
          uid: (cur.uid as string) || `${dt.sortKey}-${(cur.title as string) || ''}`,
          title: (cur.title as string) || '(no title)',
          location: (cur.location as string) || '',
          dow: dt.dow, day: dt.day, mon: dt.mon,
          timeLabel: dt.timeLabel, allDay: dt.allDay, sortKey: dt.sortKey,
        });
      }
      cur = null; continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const name = left.split(';')[0].toUpperCase();

    if (name === 'SUMMARY') cur.title = unescapeText(value);
    else if (name === 'LOCATION') cur.location = unescapeText(value);
    else if (name === 'UID') cur.uid = value.trim();
    else if (name === 'DTSTART') {
      const isDate = /VALUE=DATE(?!-TIME)/i.test(left) || !/T\d{4}/.test(value);
      cur.dt = parseDt(value, isDate);
    }
  }
  return jobs;
}

export async function getUpcomingJobs(): Promise<{ configured: boolean; events: Job[] }> {
  if (!ICS_URL) return { configured: false, events: [] };
  if (cache && Date.now() - cache.ts < 60_000) return { configured: true, events: cache.data };

  try {
    const res = await fetch(ICS_URL, {
      headers: { 'User-Agent': 'GlassAndBlastAdmin/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return { configured: true, events: [] };
    const text = await res.text();
    const cutoff = Date.now() - 18 * 60 * 60 * 1000; // keep today's earlier jobs (timezone cushion)
    const upcoming = parseIcs(text)
      .filter(j => j.sortKey >= cutoff)
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, 8);
    cache = { ts: Date.now(), data: upcoming };
    return { configured: true, events: upcoming };
  } catch {
    return { configured: true, events: [] };
  }
}
