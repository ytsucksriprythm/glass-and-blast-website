import { NextRequest, NextResponse } from 'next/server';
import { getBookingById, getPhotos, addPhoto, type PhotoType } from '@/lib/db';
import { toJpeg, storePhoto, PhotoError } from '@/lib/photos';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const photos = await getPhotos(id);
  return NextResponse.json(photos);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const booking = await getBookingById(id);
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  try {
    const form = await req.formData();
    const file = form.get('file');
    const type = (form.get('type') as string) || 'before';
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!['before', 'after', 'progress'].includes(type)) return NextResponse.json({ error: 'Invalid photo type' }, { status: 400 });

    const jpeg = await toJpeg(Buffer.from(await file.arrayBuffer()), file.type);
    const url = await storePhoto(id, jpeg);
    const photo = await addPhoto({ bookingId: id, type: type as PhotoType, url });
    return NextResponse.json(photo, { status: 201 });
  } catch (err) {
    if (err instanceof PhotoError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Photo upload error:', err);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
}
