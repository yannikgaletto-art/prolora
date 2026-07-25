import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { loadCockpit } from '@/lib/pipeline/orchestrator';

// GET /api/v1/pipeline/cockpit — Tages-Cockpit + Gate-Statistik (2B.5, §8).
// Die Gate-Statistik ist kein Zierrat: sie ist die einzige Frühwarnung dafür,
// dass die Schwellen zu eng stehen und der Nutzer nie zum Posten kommt.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const cockpit = await loadCockpit(workspaceId);
    return NextResponse.json(cockpit);
  } catch (error) {
    return handleRouteError('v1/pipeline/cockpit GET', error);
  }
}
