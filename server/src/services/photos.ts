import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

// Uploaded photos are files on the VM's disk (managers' rule; RF07's cloud storage is not used),
// served back by the API at /api/photos/<name>.

const DIR = join(config.dataDir, 'photos');
export const PHOTO_URL_PREFIX = '/api/photos/';

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type PhotoType = keyof typeof TYPES;

/** Names we generate: 32 hex characters and a known extension. Anything else is never served. */
const NAME_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

const MIME_BY_EXTENSION: Record<string, PhotoType> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

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
  mkdirSync(DIR, { recursive: true });
  const urls: string[] = [];
  try {
    for (const photo of photos) {
      const name = `${randomBytes(16).toString('hex')}.${TYPES[photo.type]}`;
      writeFileSync(join(DIR, name), photo.data);
      urls.push(PHOTO_URL_PREFIX + name);
    }
  } catch (err) {
    deletePhotos(urls);
    throw err;
  }
  return urls;
}

/** Removes uploaded photos (only ones we stored; external URLs are ignored). */
export function deletePhotos(urls: string[]) {
  for (const url of urls) {
    const path = photoPath(url.slice(PHOTO_URL_PREFIX.length));
    if (!url.startsWith(PHOTO_URL_PREFIX) || !path) continue;
    try {
      unlinkSync(path);
    } catch {
      // Already gone
    }
  }
}

/** The file for a photo name, or null if the name isn't one we could have generated. */
export function photoPath(name: string): string | null {
  return NAME_PATTERN.test(name) ? join(DIR, name) : null;
}

export const photoMimeType = (name: string): PhotoType => MIME_BY_EXTENSION[name.split('.').pop()!]!;
