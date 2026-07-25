import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { sweepStalledItems } from '@/lib/pipeline/orchestrator';

// POST /api/v1/pipeline/sweep — Aufräumen hängengebliebener Werkstücke (§8).
//
// Der eigentliche Auslöser ist der Cron-Job `pipelineStallSweep` in
// lib/pipeline/orchestrator.ts. Seine Registrierung in
// lib/inngest/functions/index.ts + app/api/inngest/route.ts gehört nicht zu
// 2B (Dateibesitz) und steht für den Integrations-Task I2 aus; bis dahin ist
// diese Route der manuelle Auslöser.
//
// Der Sweep arbeitet bewusst workspace-übergreifend (er räumt auf, was der
// Cron sonst räumen würde) — die Authentifizierung stellt lediglich sicher,
// dass ihn nicht jeder Unbekannte antriggern kann.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await getWorkspaceId(req);
    const result = await sweepStalledItems();
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/pipeline/sweep POST', error);
  }
}
