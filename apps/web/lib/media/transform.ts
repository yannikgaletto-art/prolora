import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { PlatformType, MediaItem } from '@prolora/shared';
import { getServiceDb, type MediaRef } from '@/lib/db';
import { getPlatformRules, formatFromMime } from '@/lib/validation/platform-rules';

export const MEDIA_BUCKET = 'media';
const MAX_DIMENSION = 4096;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100MB hard cap on ingest
const BLUESKY_MAX_BYTES = 950_000; // stay under the 1MB blob limit

let bucketEnsured = false;

export async function ensureMediaBucket(): Promise<void> {
  if (bucketEnsured) return;
  const db = getServiceDb();
  const { error } = await db.storage.createBucket(MEDIA_BUCKET, { public: false });
  // "already exists" is fine — anything else is fatal.
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`[media] bucket setup failed: ${error.message}`);
  }
  bucketEnsured = true;
}

// Ingest request media: external URLs are downloaded and stored in the
// PRIVATE bucket under an obfuscated path. post_groups.media stores the
// storage KEY — never a URL (Invariante 6 / R2).
export async function ingestMedia(workspaceId: string, items: MediaItem[]): Promise<MediaRef[]> {
  await ensureMediaBucket();
  const db = getServiceDb();
  const refs: MediaRef[] = [];

  for (const item of items) {
    if (!/^https?:\/\//.test(item.url)) {
      // Already a storage key (e.g. dashboard upload) — keep as-is.
      refs.push({
        type: item.type,
        storage_key: item.url,
        mime_type: item.mime_type ?? 'application/octet-stream',
        ...(item.alt_text ? { alt_text: item.alt_text } : {}),
      });
      continue;
    }

    const response = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Media download failed (HTTP ${response.status}): ${item.url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Media exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB: ${item.url}`);
    }

    const mimeType =
      item.mime_type ?? response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    const extension = formatFromMime(mimeType) || 'bin';
    const key = `workspaces/${workspaceId}/media/${randomUUID()}/original.${extension}`;

    const { error } = await db.storage.from(MEDIA_BUCKET).upload(key, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) {
      throw new Error(`[media] storage upload failed: ${error.message}`);
    }

    refs.push({
      type: item.type,
      storage_key: key,
      mime_type: mimeType,
      ...(item.alt_text ? { alt_text: item.alt_text } : {}),
    });
  }

  return refs;
}

// Fresh signed URL at PUBLISH time (1h — long enough to push bytes to the
// platform, short enough to be no leak risk).
export async function createSignedMediaUrl(storageKey: string, expiresIn = 3600): Promise<string> {
  const db = getServiceDb();
  const { data, error } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(storageKey, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`[media] signed URL failed for ${storageKey}: ${error?.message ?? 'no URL'}`);
  }
  return data.signedUrl;
}

export interface PreparedMedia {
  storageKey: string;
  mimeType: string;
}

// Platform-specific image preparation, run in the publish job:
// - EXIF rotation normalized
// - downscale to max 4096px (fit inside, never enlarge)
// - convert to JPEG when the platform doesn't support the source format
// - Bluesky: compress under the 1MB blob limit
// Aspect ratios are NEVER auto-cropped (only warned in validation).
// The ORIGINAL stays untouched; variants live next to it per platform.
export async function prepareImageForPlatform(
  platform: PlatformType,
  media: MediaRef
): Promise<PreparedMedia> {
  if (media.type !== 'image') {
    return { storageKey: media.storage_key, mimeType: media.mime_type };
  }

  const rules = getPlatformRules(platform);
  const sourceFormat = formatFromMime(media.mime_type);
  const needsConversion =
    !rules.supported_image_formats.includes(sourceFormat) &&
    rules.supported_image_formats.includes('jpeg');

  const db = getServiceDb();
  const { data: blob, error } = await db.storage.from(MEDIA_BUCKET).download(media.storage_key);
  if (error || !blob) {
    throw new Error(`[media] download failed for ${media.storage_key}: ${error?.message ?? 'no data'}`);
  }
  const input = Buffer.from(await blob.arrayBuffer());

  const metadata = await sharp(input).metadata();
  const tooLarge = (metadata.width ?? 0) > MAX_DIMENSION || (metadata.height ?? 0) > MAX_DIMENSION;
  const overBlueskyLimit = platform === 'bluesky' && input.length > BLUESKY_MAX_BYTES;

  if (!needsConversion && !tooLarge && !overBlueskyLimit) {
    return { storageKey: media.storage_key, mimeType: media.mime_type };
  }

  let output = await sharp(input)
    .rotate() // normalize EXIF orientation
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Bluesky blob limit: step down quality/size until it fits.
  if (platform === 'bluesky') {
    const qualities = [75, 60, 45];
    let dimension = MAX_DIMENSION;
    for (const quality of qualities) {
      if (output.length <= BLUESKY_MAX_BYTES) break;
      dimension = Math.round(dimension * 0.7);
      output = await sharp(input)
        .rotate()
        .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    }
    if (output.length > BLUESKY_MAX_BYTES) {
      throw new Error('[media] image cannot be compressed under the Bluesky 1MB limit');
    }
  }

  const variantKey = variantKeyFor(media.storage_key, platform);
  const { error: uploadError } = await db.storage
    .from(MEDIA_BUCKET)
    .upload(variantKey, output, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) {
    throw new Error(`[media] variant upload failed: ${uploadError.message}`);
  }

  return { storageKey: variantKey, mimeType: 'image/jpeg' };
}

function variantKeyFor(originalKey: string, platform: PlatformType): string {
  const dir = originalKey.includes('/')
    ? originalKey.slice(0, originalKey.lastIndexOf('/'))
    : originalKey;
  return `${dir}/variants/${platform}.jpeg`;
}
