// Row → record mapping and cursor pagination for MCP tool output.
//
// Mapping is GENERIC: every column the read-only role can see comes through,
// snake_case → camelCase, so a column added to a table later shows up in the
// connector automatically instead of being silently dropped. Values are
// preserved as stored:
//   - SQL NULL  → null   ("never recorded / not applicable")
//   - ''        → ''     ("recorded as blank")
//   - timestamps → ISO-8601 UTC strings; numerics → numbers
//   - JSON-in-TEXT columns (invoice items, quote lines, booking_ids, activity
//     meta, ...) are parsed; if a value fails to parse it's returned raw with a
//     `<field>ParseError` flag rather than being dropped.
// Anything computed rather than stored lives under a separate `computed` key.

import { signBlob, verifyBlob, sha256Hex } from './crypto';
import type { Row } from './sql';

const NUMERIC_COLS = new Set([
  'quote_amount', 'amount', 'subtotal', 'total', 'visit_price', 'discount', 'square_link_amount',
  'sort_order', 'seq', 'view_count', 'feedback_stars', 'custom_interval_weeks', 'max_scroll_percent',
  'duration_seconds', 'sort', 'last_seq',
]);
const JSON_COLS = new Set(['items', 'booking_ids', 'services', 'extras', 'item_amounts', 'other_lines', 'meta']);

export function camel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function isTimestampCol(col: string): boolean {
  return col.endsWith('_at') || col === 'scheduled_end';
}

export function normalizeTimestamp(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function toRecord(row: Row, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [col, raw] of Object.entries(row)) {
    if (omit.includes(col)) continue;
    const key = camel(col);
    if (raw === null || raw === undefined) { out[key] = null; continue; }
    if (isTimestampCol(col)) { out[key] = normalizeTimestamp(raw); continue; }
    if (NUMERIC_COLS.has(col)) { const n = Number(raw); out[key] = Number.isFinite(n) ? n : raw; continue; }
    if (JSON_COLS.has(col) && typeof raw === 'string') {
      try { out[key] = JSON.parse(raw); } catch { out[key] = raw; out[`${key}ParseError`] = true; }
      continue;
    }
    if (typeof raw === 'bigint') { out[key] = Number(raw); continue; }
    out[key] = raw;
  }
  return out;
}

// ─── Pagination ─────────────────────────────────────────────────────────────
// Offset cursors, HMAC-signed so they can't be forged or reused with
// different filters. Each cursor pins an `asOf` snapshot time: list queries
// add `created_at <= asOf`, so records created while ChatGPT is paging don't
// shift later pages (it'll see them on a fresh search instead).

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

interface CursorState { o: number; a: string; h: string }

export interface PageStart { offset: number; asOf: string; filterHash: string; pageSize: number }

export class CursorError extends Error {}

export function startPage(filters: unknown, cursor: string | undefined, pageSize: number | undefined, secret: string): PageStart {
  const filterHash = sha256Hex(JSON.stringify(filters ?? {})).slice(0, 24);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? DEFAULT_PAGE_SIZE));
  if (!cursor) return { offset: 0, asOf: new Date().toISOString(), filterHash, pageSize: size };
  const state = verifyBlob<CursorState>('cursor', cursor, secret);
  if (!state || typeof state.o !== 'number' || state.o < 0) throw new CursorError('Invalid or tampered cursor. Start the listing again without a cursor.');
  if (state.h !== filterHash) throw new CursorError('This cursor belongs to a listing with different filters. Pass exactly the same filters as the first page.');
  return { offset: state.o, asOf: state.a, filterHash, pageSize: size };
}

export interface Page<T> {
  total: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  nextCursor: string | null;
  asOf: string;
  items: T[];
}

export function buildPage<T>(items: T[], total: number, start: PageStart, secret: string): Page<T> {
  const next = start.offset + items.length;
  const hasMore = next < total;
  return {
    total,
    returned: items.length,
    offset: start.offset,
    hasMore,
    nextCursor: hasMore ? signBlob('cursor', { o: next, a: start.asOf, h: start.filterHash } satisfies CursorState, secret) : null,
    asOf: start.asOf,
    items,
  };
}

// For lists assembled in JS (payments, projected visits): slice + page.
export function pageArray<T>(all: T[], start: PageStart, secret: string): Page<T> {
  return buildPage(all.slice(start.offset, start.offset + start.pageSize), all.length, start, secret);
}

// ─── Small SQL builder ──────────────────────────────────────────────────────

export class Where {
  parts: string[] = [];
  params: unknown[] = [];
  p(v: unknown): string { this.params.push(v); return `$${this.params.length}`; }
  add(clause: string): this { this.parts.push(clause); return this; }
  sql(): string { return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : ''; }
}

// Escapes LIKE wildcards in user input; use with `ESCAPE '\'`.
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}
export function contains(s: string): string {
  return `%${likeEscape(s)}%`;
}

// Digits of a phone number with the country/trunk prefix removed, so
// "+61 412 345 678", "0412345678" and "412 345 678" all compare equal.
export const PHONE_CORE_SQL = (col: string) => `regexp_replace(regexp_replace(${col}, '\\D', '', 'g'), '^(61|0)', '')`;
export function phoneCore(input: string): string {
  return input.replace(/\D/g, '').replace(/^(61|0)/, '');
}
