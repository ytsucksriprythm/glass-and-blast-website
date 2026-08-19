// "How did this visitor find us" — combines UTM params (reliable, if the
// linked profile/ad sets them) with a referrer-hostname fallback (works for
// plain links, but many apps' in-app browsers — notably Facebook/Instagram —
// strip the referrer entirely, so a UTM tag is the only reliable way to
// attribute those specifically). Computed here, server-side, so the label
// stored against a booking is always one of a known, controlled set rather
// than arbitrary client-supplied text — see /api/bookings.
//
// To get "Facebook (bio link)" / "Google Maps" instead of a generic
// "Facebook" / "Google (search)", tag the outbound links themselves:
//   Facebook bio:  https://glassandblast.com.au/?utm_source=facebook&utm_medium=bio
//   Instagram bio: https://glassandblast.com.au/?utm_source=instagram&utm_medium=bio
//   Google Business Profile / Maps "website" button:
//                  https://glassandblast.com.au/?utm_source=google&utm_medium=maps

export interface AttributionInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}

export function labelAttribution(input: AttributionInput): string {
  const source = (input.utmSource || '').trim().toLowerCase().slice(0, 60);
  const medium = (input.utmMedium || '').trim().toLowerCase().slice(0, 60);

  if (source) {
    if (source === 'google' && medium === 'maps') return 'Google Maps';
    if (source === 'google' && ['cpc', 'ppc', 'ad', 'ads'].includes(medium)) return 'Google Ads';
    if (source === 'google') return 'Google';
    if ((source === 'facebook' || source === 'fb') && ['bio', 'profile', 'link'].includes(medium)) return 'Facebook (bio link)';
    if (source === 'facebook' || source === 'fb') return 'Facebook';
    if (source === 'instagram' || source === 'ig') {
      return ['bio', 'profile', 'link'].includes(medium) ? 'Instagram (bio link)' : 'Instagram';
    }
    // Unknown-but-tagged source: title-case it, e.g. "yelp" -> "Yelp".
    const label = source.charAt(0).toUpperCase() + source.slice(1);
    return medium ? `${label} (${medium})` : label;
  }

  // No UTM tag — fall back to the referrer's hostname.
  const ref = (input.referrer || '').trim();
  if (!ref) return 'Direct';
  let host = '';
  try { host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'Direct'; }
  if (!host) return 'Direct';

  if (host.includes('google.')) return (ref.includes('/maps') || host.startsWith('maps.')) ? 'Google Maps' : 'Google (search)';
  if (host === 'fb.me' || host.includes('facebook.com')) return 'Facebook';
  if (host.includes('instagram.com')) return 'Instagram';
  if (host.includes('bing.com')) return 'Bing';
  if (host.includes('yahoo.')) return 'Yahoo';
  if (host === 'glassandblast.com.au') return 'Direct'; // internal navigation shouldn't normally reach here
  return host.slice(0, 60); // unrecognised referrer — show the raw domain rather than guess
}

// ─── Client-side: capture once, read at booking time ───────────────────────
// First-touch attribution: the channel that brought someone here the FIRST
// time they ever landed on the site, not whatever channel they clicked
// through most recently — that's what answers "how did this customer find
// us" for a lead-gen local business, where the actual booking often happens
// days or weeks after discovery. Persisted in localStorage (survives tab
// close, unlike sessionStorage) with a 90-day expiry so a customer who
// vanishes and organically reappears months later gets re-attributed rather
// than keeping a stale first touch forever.

const ATTRIBUTION_KEY = 'gb_attribution';
const ATTRIBUTION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;

// Called once per page load (see PageTracker). No-ops if a fresh first touch
// is already stored — never overwrites it with a later visit.
export function captureFirstTouchAttribution(): void {
  try {
    const existingRaw = localStorage.getItem(ATTRIBUTION_KEY);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      if (typeof existing?.capturedAt === 'number' && Date.now() - existing.capturedAt < ATTRIBUTION_MAX_AGE_MS) return;
    }
    const params = new URLSearchParams(window.location.search);
    const data: AttributionInput & { capturedAt: number } = {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      referrer: document.referrer || null,
      capturedAt: Date.now(),
    };
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(data));
  } catch {
    /* localStorage can throw in private-browsing/storage-blocked contexts — never break the page */
  }
}

// Read at booking-form submit time (see Book() in src/app/page.tsx).
export function readFirstTouchAttribution(): AttributionInput | null {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { utmSource: d.utmSource ?? null, utmMedium: d.utmMedium ?? null, utmCampaign: d.utmCampaign ?? null, referrer: d.referrer ?? null };
  } catch {
    return null;
  }
}
