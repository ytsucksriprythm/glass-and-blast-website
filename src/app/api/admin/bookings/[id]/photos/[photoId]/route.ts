import { NextRequest, NextResponse } from 'next/server';
import { deletePhoto } from '@/lib/db';
import { removeStoredPhoto } from '@/lib/photos';
import { isAdminAuthenticated } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { photoId } = await params;
  const removed = await deletePhoto(photoId);
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await removeStoredPhoto(removed.url);
  return NextResponse.json({ success: true });
}
