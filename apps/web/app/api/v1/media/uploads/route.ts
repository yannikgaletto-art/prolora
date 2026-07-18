import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { MEDIA_BUCKET } from '@/lib/media/transform';

// POST /api/v1/media/uploads — user-provided file into the PRIVATE bucket,
// zero AI budget (spec). multipart/form-data with a single "file" field.
// Returns the storage key as a MediaItem-compatible url (ingestMedia treats
// non-http urls as existing storage keys).

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const ALLOWED: Record<string, { type: 'image' | 'video' | 'document'; extension: string }> = {
  'image/jpeg': { type: 'image', extension: 'jpg' },
  'image/png': { type: 'image', extension: 'png' },
  'image/webp': { type: 'image', extension: 'webp' },
  'image/gif': { type: 'image', extension: 'gif' },
  'video/mp4': { type: 'video', extension: 'mp4' },
  'video/quicktime': { type: 'video', extension: 'mov' },
  'application/pdf': { type: 'document', extension: 'pdf' },
};

// Magic-byte sniff — the declared MIME must match the decoded file type
// (spec "Uploads are restricted by media type, extension, decoded file type").
function sniffMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return jsonError(400, 'Send multipart/form-data with a "file" field.', 'invalid_request');
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return jsonError(400, `File must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`, 'invalid_file');
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(bytes);
    const allowed = sniffed ? ALLOWED[sniffed] : undefined;
    if (!sniffed || !allowed) {
      return jsonError(
        400,
        'Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, PDF.',
        'invalid_file'
      );
    }

    const db = getServiceDb();
    const key = `workspaces/${workspaceId}/media/${randomUUID()}/original.${allowed.extension}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(key, bytes, {
      contentType: sniffed,
      upsert: false,
    });
    if (error) {
      throw new Error(`[media-uploads] storage upload failed: ${error.message}`);
    }

    // Short-lived preview so the UI can show what was just uploaded.
    const { data: signed } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(key, 600);

    return NextResponse.json(
      {
        media_item: { type: allowed.type, url: key, mime_type: sniffed },
        preview_url: signed?.signedUrl ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/media/uploads POST', error);
  }
}
