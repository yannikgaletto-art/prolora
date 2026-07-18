import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getGenerationWithPreview } from '@/lib/media/generation';

// GET /api/v1/media/generations/:id — workspace-scoped status + short-lived
// signed preview URL (spec: permanent public media URLs are never stored).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const generation = await getGenerationWithPreview(workspaceId, id);
    if (!generation) {
      return jsonError(404, 'Generation not found.', 'not_found');
    }
    return NextResponse.json({
      generation: {
        id: generation.id,
        kind: generation.kind,
        format: generation.format,
        prompt: generation.prompt,
        status: generation.status,
        model: generation.model,
        storage_key: generation.storage_key,
        mime_type: generation.mime_type,
        error_message: generation.error_message,
        created_at: generation.created_at,
        completed_at: generation.completed_at,
        preview_url: generation.preview_url,
      },
    });
  } catch (error) {
    return handleRouteError('v1/media/generations/:id GET', error);
  }
}
