import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getBrandProfile } from '@/lib/media/brand-profile';
import { MEDIA_BUCKET } from '@/lib/media/transform';
import { renderAndStoreVisual, visualRenderSchema } from '@/lib/media/visual-templates';

// POST /api/v1/visuals (Plan 2 / 2A.6).
// Rendert ein deterministisches Template und legt das PNG im privaten
// Media-Bucket ab. Kein Provider-Aufruf, keine Budget-Reservierung, Kosten = 0.

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = visualRenderSchema.parse(body);

    const profile = await getBrandProfile(workspaceId);
    const stored = await renderAndStoreVisual(workspaceId, input.template, {
      format: input.format,
      profile,
    });

    // Kurzlebige Vorschau (Invariante 6 / R2 — gespeichert wird der Key).
    const db = getServiceDb();
    const { data: signed } = await db.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(stored.storageKey, 600);

    return NextResponse.json(
      {
        media_item: { type: 'image', url: stored.storageKey, mime_type: stored.mimeType },
        visual: {
          storage_key: stored.storageKey,
          width: stored.width,
          height: stored.height,
          format: stored.format,
          bytes: stored.bytes,
          estimated_eur: stored.estimatedEur,
        },
        preview_url: signed?.signedUrl ?? null,
        brand_profile_configured: profile.configured,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/visuals POST', error);
  }
}
