import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { config } from '../config';

// Uploaded photos are files on the VM's disk (managers' rule; RF07's cloud storage is not used),
// under random names, served as static files at /api/photos/<name> (see app.ts).

export const PHOTOS_DIR = resolve(config.dataDir, 'photos');
export const PHOTO_URL_PREFIX = '/api/photos/';

mkdirSync(PHOTOS_DIR, { recursive: true });

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export type PhotoType = keyof typeof EXTENSIONS;

/**
 * The real type of an upload, read from its first bytes. The file name and the type the
 * browser declares are ignored: both are trivial to fake.
 */
export function detectPhotoType(data: Buffer): PhotoType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Saves photos under random names and returns their URLs, in the same order. */
export function savePhotos(photos: { data: Buffer; type: PhotoType }[]): string[] {
  const urls: string[] = [];
  try {
    for (const photo of photos) {
      const name = `${randomBytes(16).toString('hex')}.${EXTENSIONS[photo.type]}`;
      writeFileSync(join(PHOTOS_DIR, name), photo.data);
      urls.push(PHOTO_URL_PREFIX + name);
    }
  } catch (err) {
    deletePhotos(urls);
    throw err;
  }
  return urls;
}

/** Removes photos saved by `savePhotos`, e.g. when creating the auction failed. */
export function deletePhotos(urls: string[]) {
  for (const url of urls) {
    try {
      unlinkSync(join(PHOTOS_DIR, basename(url)));
    } catch {
      // Already gone
    }
  }
}
