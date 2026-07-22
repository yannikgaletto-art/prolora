import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { MEDIA_BUCKET } from '@/lib/media/transform';
import { downloadFilename, isWorkspaceMediaKey } from '@/lib/media/library';

// GET /api/v1/media/download?key=... — redirects to a short-lived signed URL
// with Content-Disposition: attachment. The key-prefix check IS the workspace
// scoping (every media key embeds its workspace id — Invariante 2); a foreign
// or malformed key 404s without touching Storage.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const key = req.nextUrl.searchParams.get('key') ?? '';
    if (!isWorkspaceMediaKey(workspaceId, key)) {
      return jsonError(404, 'Media not found.', 'not_found');
    }

    const db = getServiceDb();
    const { data, error } = await db.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(key, 300, { download: downloadFilename(key) });
    if (error || !data?.signedUrl) {
      return jsonError(404, 'Media not found.', 'not_found');
    }
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    return handleRouteError('v1/media/download GET', error);
  }
}
