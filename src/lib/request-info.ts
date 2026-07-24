// Server-only helpers for pulling IP + approximate location out of an
// incoming request. Used by the invoice view-session logging.
import type { NextRequest } from 'next/server';

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function isPrivateIp(ip: string): boolean {
  return !ip || ip === 'unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// Prefers Vercel's own edge geo headers (free, instant, production-only —
// Vercel adds these automatically). Falls back to a free IP-lookup API for
// local dev or any host that doesn't set them. Best-effort: never throws.
export async function getGeo(req: NextRequest, ip: string): Promise<{ city: string | null; region: string | null; country: string | null }> {
  const vCity = req.headers.get('x-vercel-ip-city');
  const vCountry = req.headers.get('x-vercel-ip-country');
  const vRegion = req.headers.get('x-vercel-ip-country-region');
  if (vCity || vCountry) {
    return { city: vCity ? decodeURIComponent(vCity) : null, region: vRegion || null, country: vCountry || null };
  }
  if (isPrivateIp(ip)) return { city: null, region: null, country: null };
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`);
    const data = await res.json();
    if (data.status === 'success') return { city: data.city || null, region: data.regionName || null, country: data.country || null };
  } catch { /* best-effort — a failed lookup just means no location shown */ }
  return { city: null, region: null, country: null };
}
