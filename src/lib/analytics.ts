// Pure, side-effect-free aggregation helpers for site-traffic analytics.
// Shared between the live app (src/lib/db.ts's getSiteStats, consumed by
// the admin Site Stats tab) and the read-only Claude connector
// (mcp-server/index.ts's buildSiteStats) so both compute identical numbers
// from the same raw rows instead of keeping two copies of the same math
// that could quietly drift apart. No imports from db.ts or fs — safe to
// import from a client component too (Book() uses BOOKING_FUNNEL_STEPS).

interface ScrollableView {
  path: string;
  visitor: string;
  maxScrollPercent?: number | null;
  durationSeconds?: number | null;
}

export interface PageEngagement {
  path: string;
  views: number;
  avgScrollPercent: number | null;
  scrollSamples: number;
  avgTimeOnPageSeconds: number | null;
  timeSamples: number;
}

export interface ScrollBucket { label: string; count: number }

const SCROLL_BUCKET_DEFS = [
  { label: '0–25%', min: 0, max: 25 },
  { label: '26–50%', min: 26, max: 50 },
  { label: '51–75%', min: 51, max: 75 },
  { label: '76–100%', min: 76, max: 100 },
];

// Per-page averages, in the order/selection the caller already ranked
// (e.g. "top 8 pages by views") — this just attaches scroll/time data to
// that existing list rather than re-deriving which pages matter.
export function computePageEngagement(
  views: ScrollableView[],
  rankedPaths: { path: string; views: number }[],
): PageEngagement[] {
  const scrollByPage: Record<string, { sum: number; count: number }> = {};
  const timeByPage: Record<string, { sum: number; count: number }> = {};
  views.forEach(v => {
    if (typeof v.maxScrollPercent === 'number') {
      const e = scrollByPage[v.path] ?? (scrollByPage[v.path] = { sum: 0, count: 0 });
      e.sum += v.maxScrollPercent; e.count += 1;
    }
    if (typeof v.durationSeconds === 'number') {
      const e = timeByPage[v.path] ?? (timeByPage[v.path] = { sum: 0, count: 0 });
      e.sum += v.durationSeconds; e.count += 1;
    }
  });
  return rankedPaths.map(p => ({
    path: p.path,
    views: p.views,
    avgScrollPercent: scrollByPage[p.path] ? Math.round(scrollByPage[p.path].sum / scrollByPage[p.path].count) : null,
    scrollSamples: scrollByPage[p.path]?.count ?? 0,
    avgTimeOnPageSeconds: timeByPage[p.path] ? Math.round(timeByPage[p.path].sum / timeByPage[p.path].count) : null,
    timeSamples: timeByPage[p.path]?.count ?? 0,
  }));
}

// Only views that actually reported a beacon count (a bounce before the JS
// listener attaches, or a killed tab, means no data — that's honestly
// different from "left at 0%", so it's excluded rather than counted as 0).
export function computeScrollBuckets(views: ScrollableView[]): { buckets: ScrollBucket[]; sampleCount: number } {
  const withScroll = views.filter((v): v is ScrollableView & { maxScrollPercent: number } => typeof v.maxScrollPercent === 'number');
  const buckets = SCROLL_BUCKET_DEFS.map(b => ({
    label: b.label,
    count: withScroll.filter(v => v.maxScrollPercent >= b.min && v.maxScrollPercent <= b.max).length,
  }));
  return { buckets, sampleCount: withScroll.length };
}

export interface TimeStats {
  avgTimeOnPageSeconds: number | null;
  timeSamples: number;
  avgSessionDurationSeconds: number | null;
  sessionSamples: number;
}

// "Session" = one visitor's daily hash (PageView.visitor resets every day —
// see /api/track), so grouping by it is already a reasonable session proxy
// without a separate inactivity-gap algorithm: sum each visitor's time
// across every page they viewed that day, then average across visitors.
export function computeSiteWideTimeStats(views: ScrollableView[]): TimeStats {
  const withTime = views.filter((v): v is ScrollableView & { durationSeconds: number } => typeof v.durationSeconds === 'number');
  const avgTimeOnPageSeconds = withTime.length
    ? Math.round(withTime.reduce((s, v) => s + v.durationSeconds, 0) / withTime.length) : null;

  const byVisitor: Record<string, number> = {};
  withTime.forEach(v => { byVisitor[v.visitor] = (byVisitor[v.visitor] ?? 0) + v.durationSeconds; });
  const sessionTotals = Object.values(byVisitor);
  const avgSessionDurationSeconds = sessionTotals.length
    ? Math.round(sessionTotals.reduce((a, b) => a + b, 0) / sessionTotals.length) : null;

  return { avgTimeOnPageSeconds, timeSamples: withTime.length, avgSessionDurationSeconds, sessionSamples: sessionTotals.length };
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// ─── Booking-form funnel ──────────────────────────────────────────────────
// How far down the booking form (src/app/page.tsx's Book component) people
// get before either submitting or leaving. Field-level, not page-level —
// the form itself is a single section, not separate routes, so this can't
// reuse the page-view/scroll-depth machinery above.

export const BOOKING_FUNNEL_STEPS = ['name', 'phone', 'service', 'address', 'extras', 'submitted'] as const;
export type BookingFunnelStep = typeof BOOKING_FUNNEL_STEPS[number];

export const BOOKING_FUNNEL_LABELS: Record<BookingFunnelStep, string> = {
  name: 'Entered name',
  phone: 'Entered phone',
  service: 'Picked a service',
  address: 'Entered address',
  extras: 'Opened optional extras',
  submitted: 'Submitted the form',
};

interface FunnelRow { step: string }
export interface FunnelStepCount { step: BookingFunnelStep; label: string; count: number }

// Cumulative "reached at least this step" counts — the standard funnel
// shape (each step's count is >= the next one's), computed from one row per
// session recording only the *furthest* step that session reached.
export function computeBookingFunnel(events: FunnelRow[]): { steps: FunnelStepCount[]; started: number } {
  const stepIndex = (s: string) => BOOKING_FUNNEL_STEPS.indexOf(s as BookingFunnelStep);
  const steps = BOOKING_FUNNEL_STEPS.map((step, i) => ({
    step,
    label: BOOKING_FUNNEL_LABELS[step],
    count: events.filter(e => stepIndex(e.step) >= i).length,
  }));
  return { steps, started: events.length };
}
