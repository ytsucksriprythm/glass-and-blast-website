import { list, del } from '@vercel/blob';

// Public file library ("Media Library" in admin settings) — separate from the
// booking-photos store (photos.ts). Everything under this prefix is meant to
// be shared outside the app: ad creatives, downloadable assets, anything the
// owner wants a plain public URL for (Meta ads, sending a link, etc). No auth
// on the URL itself — that's the point — but every list/upload/delete call
// through the admin API is gated behind isAdminAuthenticated().
export const MEDIA_PREFIX = 'media/';

export interface MediaItem {
  url: string;
  pathname: string; // full blob pathname, e.g. "media/1700000000-abc12-ad-1.mp4"
  filename: string; // pathname with the media/ prefix stripped, for display
  size: number;
  uploadedAt: string;
  contentType?: string;
}

export async function listMedia(): Promise<MediaItem[]> {
  const { blobs } = await list({ prefix: MEDIA_PREFIX });
  return blobs
    .map(b => ({
      url: b.url,
      pathname: b.pathname,
      filename: b.pathname.slice(MEDIA_PREFIX.length),
      size: b.size,
      uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt.toISOString() : String(b.uploadedAt),
      contentType: 'contentType' in b ? (b as { contentType?: string }).contentType : undefined,
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// Only ever deletes blobs under MEDIA_PREFIX — refuses anything else so this
// can't be pointed at booking photos or other stores by a stray URL.
export async function deleteMedia(url: string): Promise<void> {
  const pathname = new URL(url).pathname.replace(/^\//, '');
  if (!pathname.startsWith(MEDIA_PREFIX)) throw new Error('Refusing to delete outside the media library');
  await del(url);
}

// Keeps the original filename recognisable in the URL while guaranteeing
// uniqueness (Blob would otherwise add its own random suffix mid-name).
export function buildMediaPathname(originalName: string): string {
  const safe = originalName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return `${MEDIA_PREFIX}${stamp}-${safe}`;
}
