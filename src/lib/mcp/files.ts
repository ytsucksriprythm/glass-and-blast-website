// Short-lived photo links for the MCP connector. A tool hands out
// /api/mcp-files/photo?t=<signed {photo id, expiry}>; this handler checks the
// signature and expiry, looks the photo up by id (read-only role), and streams
// it. The stored Blob URL itself is never revealed, and this is NOT a general
// URL fetcher: the only URL ever fetched is the one stored for that photo id,
// and only from Vercel Blob storage.

import { getMcpConfig } from './config';
import { verifyBlob } from './crypto';
import { getReadDb, readOne, assertReadOnlyRole } from './sql';
import { notConfigured } from './oauth';
import { audit } from './authStore';

const ALLOWED_HOST = /\.public\.blob\.vercel-storage\.com$/;
const MAX_BYTES = 20 * 1024 * 1024;

function plain(status: number, msg: string): Response {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

export async function handlePhoto(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  const t = new URL(req.url).searchParams.get('t') ?? '';
  const claim = verifyBlob<{ id: string; exp: number }>('file-link', t, cfg.tokenSecret);
  if (!claim || typeof claim.id !== 'string' || typeof claim.exp !== 'number') return plain(403, 'Invalid link.');
  if (claim.exp < Date.now() / 1000) return plain(410, 'This photo link has expired. Ask ChatGPT for a fresh link.');

  const db = getReadDb(cfg.readDatabaseUrl);
  await assertReadOnlyRole(db);
  const rows = await readOne(db, `SELECT url FROM booking_photos WHERE id = $1`, [claim.id]);
  const url = rows[0]?.url ? String(rows[0].url) : '';
  let target: URL;
  try { target = new URL(url); } catch { return plain(404, 'Photo not found.'); }
  if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname)) return plain(404, 'Photo not available.');

  const upstream = await fetch(target, { redirect: 'error' });
  if (!upstream.ok || !upstream.body) return plain(502, 'Photo could not be loaded.');
  const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!type.startsWith('image/')) return plain(415, 'Not an image.');
  const size = Number(upstream.headers.get('content-length') ?? '0');
  if (size > MAX_BYTES) return plain(413, 'Photo too large.');

  void audit({ event: 'photo_view', ok: true, tool: 'photo_link', detail: { photoId: claim.id } });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
