import fs from 'fs';
import path from 'path';
import { put, del } from '@vercel/blob';
import { Jimp, JimpMime } from 'jimp';
import convert from 'heic-convert';

// Photo storage: Vercel Blob in production (BLOB_READ_WRITE_TOKEN set by the
// Vercel integration), plain files under public/uploads during local dev so
// nothing external is needed to develop.

const LOCAL_DIR = path.join(process.cwd(), 'public', 'uploads');
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

const MAX_WIDTH = 1600;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // iPhone photos are ~3-8MB

export class PhotoError extends Error {}

// Normalise any camera upload to a web-friendly JPEG: HEIC converted, large
// images resized down, EXIF rotation baked in by jimp.
export async function toJpeg(input: Buffer, mimeType: string): Promise<Buffer> {
  if (input.length > MAX_UPLOAD_BYTES) throw new PhotoError('Photo is too large (max 15MB)');

  let buf = input;
  if (/hei[cf]/i.test(mimeType)) {
    const converted = await convert({ buffer: input, format: 'JPEG', quality: 0.85 });
    buf = Buffer.from(converted);
  }

  const image = await Jimp.read(buf);
  if (image.width > MAX_WIDTH) image.resize({ w: MAX_WIDTH });
  return image.getBuffer(JimpMime.jpeg, { quality: 80 });
}

// Store a processed JPEG; returns the public URL to save against the booking.
export async function storePhoto(bookingId: string, jpeg: Buffer): Promise<string> {
  const filename = `${bookingId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;

  if (useBlob()) {
    const blob = await put(`booking-photos/${filename}`, jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
    });
    return blob.url;
  }

  const filePath = path.join(LOCAL_DIR, filename.replace('/', '-'));
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(filePath, jpeg);
  return `/uploads/${path.basename(filePath)}`;
}

// Best-effort file removal after the DB row is gone; a stray blob is harmless.
export async function removeStoredPhoto(url: string): Promise<void> {
  try {
    if (url.startsWith('/uploads/')) {
      const filePath = path.join(LOCAL_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } else if (useBlob()) {
      await del(url);
    }
  } catch (err) {
    console.error('[photos] failed to remove stored file:', err);
  }
}
