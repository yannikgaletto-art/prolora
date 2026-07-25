import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getContentItem, listTransitions, listVariants } from '@/lib/pipeline/state';
import { describeProvenance } from '@/lib/pipeline/orchestrator';

// GET /api/v1/pipeline/items/:id — Werkstück samt kanal-nativen Varianten und
// vollständigem Übergangs-Protokoll. Das Protokoll ist Teil der Antwort, weil
// die UI die Herkunfts-Kette zeigen muss und ein Zustand ohne Begründung in
// diesem System nicht existieren darf.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const item = await getContentItem(workspaceId, id);
    if (!item) {
      return jsonError(404, 'Content item not found.', 'not_found');
    }
    const [variants, transitions] = await Promise.all([
      listVariants(workspaceId, id),
      listTransitions(workspaceId, id),
    ]);
    return NextResponse.json({
      item,
      variants,
      transitions,
      provenance: describeProvenance(item),
    });
  } catch (error) {
    return handleRouteError('v1/pipeline/items/:id GET', error);
  }
}
