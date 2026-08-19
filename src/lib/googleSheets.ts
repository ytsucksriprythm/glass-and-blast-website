import crypto from 'crypto';

// Minimal Google service-account auth + Sheets read/write, hand-rolled with
// `fetch` and Node's built-in `crypto` instead of pulling in `googleapis` (a
// heavy dependency) — this app only ever needs a handful of calls.
//
// Requires the Sheet to be shared with the service account's `client_email`
// as Editor (not just Viewer) — the status write-back needs write access,
// and the Sheets API enforces the Drive-level share regardless of what
// OAuth scope we request.

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function getServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key');
  return { client_email: key.client_email, private_key: key.private_key };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Cached for the lifetime of the serverless function instance — cold starts
// just fetch a fresh one, which is fine at this call volume.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 30) return cachedToken.token;

  const key = getServiceAccountKey();
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signInput).sign(key.private_key);
  const jwt = `${signInput}.${base64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text().catch(() => '')}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return cachedToken.token;
}

// Every tab (sheet) title in the spreadsheet, in display order — Meta's
// Connect CRM writes one tab per lead form, and forms get added/renamed as
// you trial new ones, so this is discovered live rather than configured.
export async function listSheetTabs(spreadsheetId: string): Promise<string[]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API metadata read failed (${res.status}): ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return ((data.sheets ?? []) as Array<{ properties?: { title?: string } }>)
    .map(s => s.properties?.title)
    .filter((t): t is string => Boolean(t));
}

// A1 range within one tab, e.g. listSheetTabs() result + "!A:Z".
const a1Range = (tab: string, suffix: string) => `'${tab.replace(/'/g, "''")}'!${suffix}`;

// Reads a range as a grid of strings (row 0 = headers, matching how the
// Sheets API returns `values`). Empty trailing cells in a row are just
// missing from that row's array — callers should index defensively.
export async function fetchSheetRows(spreadsheetId: string, tab: string, rangeSuffix: string): Promise<string[][]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1Range(tab, rangeSuffix))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API read failed (${res.status}): ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Writes a single cell given a 0-indexed column and 1-indexed row (row 1 =
// the header row, matching what you'd see on-screen in Sheets).
export async function writeSheetCell(spreadsheetId: string, tab: string, row1Indexed: number, col0Indexed: number, value: string): Promise<void> {
  const token = await getAccessToken();
  const range = a1Range(tab, `${colLetter(col0Indexed)}${row1Indexed}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: [[value]] }),
  });
  if (!res.ok) throw new Error(`Sheets API write failed (${res.status}): ${await res.text().catch(() => '')}`);
}
