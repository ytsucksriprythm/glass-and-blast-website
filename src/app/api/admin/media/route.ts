import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { listMedia, deleteMedia } from '@/lib/media';
import { logActivity } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await listMedia());
  } catch (err) {
    console.error('Media list error:', err);
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  try {
    await deleteMedia(url);
    await logActivity('media.deleted', `Media file deleted: ${decodeURIComponent(url.split('/').pop() || url)}`, { url }, 'admin');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Media delete error:', err);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
