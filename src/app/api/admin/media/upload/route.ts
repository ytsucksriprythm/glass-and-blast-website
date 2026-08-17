import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAdminAuthenticated } from '@/lib/auth';
import { MEDIA_PREFIX } from '@/lib/media';
import { logActivity } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Client-direct-to-Blob upload: the browser PUTs the file straight to Vercel
// Blob using a short-lived token from here, never through our own server —
// avoids the serverless function request-body limit, which matters for the
// multi-hundred-MB ad videos this is built for.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // The client picks the pathname; only ever allow it inside the media
        // library folder so this token can't be used to touch booking photos
        // or anything else in the store.
        if (!pathname.startsWith(MEDIA_PREFIX)) throw new Error('Invalid upload path');
        return {
          allowedContentTypes: ['video/*', 'image/*', 'application/pdf'],
          addRandomSuffix: false,
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2GB ceiling, well above any single ad
        };
      },
      onUploadCompleted: async ({ blob }) => {
        const filename = blob.pathname.slice(MEDIA_PREFIX.length);
        await logActivity('media.uploaded', `File uploaded to media library: ${filename}`, { url: blob.url }, 'admin');
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error('Media upload token error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 400 });
  }
}
