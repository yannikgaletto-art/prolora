import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { acceptProofSuggestion, rejectProofSuggestion } from '@/lib/feedback/proof-extraction';
import { confirmFactSuggestion } from '@/lib/product/facts';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

// POST /api/v1/product/proof-suggestions/[id] (Plan 2 / 2A.3).
//
// Der EINZIGE Weg vom Vorschlag zum proof_asset. Bewusst ein expliziter,
// authentifizierter Aufruf mit Nutzerkontext — kein Nebeneffekt eines Scans.
//
// DSGVO: ist der Vorschlag zustimmungspflichtig (Kundenzitat) und wird kein
// `consent_reference` mitgeliefert, entsteht der Beleg mit
// consent_status='pending' und ist im Quality-Gate NICHT verwendbar. Die
// Antwort sagt das mit `usable_in_gate` ausdrücklich.

const idSchema = z.string().uuid();

const bodySchema = z.object({
  decision: z.enum(['accept', 'confirm_fact', 'reject']),
  consent_reference: z.string().trim().min(3).max(300).nullish(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const { id } = await params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      return jsonError(400, 'Ungültige Vorschlags-ID.', 'invalid_request');
    }

    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = bodySchema.parse(body);

    if (input.decision === 'reject') {
      const rejected = await rejectProofSuggestion(auth.workspaceId, parsedId.data, auth.userId);
      if (!rejected) return jsonError(404, 'Proof-Vorschlag nicht gefunden.', 'not_found');
      return NextResponse.json({ status: 'rejected' });
    }

    if (input.decision === 'confirm_fact') {
      const manager = await requireWriterOwnerOrAdmin(auth);
      const fact = await confirmFactSuggestion(auth.workspaceId, parsedId.data, manager.userId);
      return NextResponse.json({ status: 'accepted', fact }, { status: 201 });
    }

    const result = await acceptProofSuggestion(auth.workspaceId, parsedId.data, {
      consentReference: input.consent_reference ?? null,
      decidedBy: auth.userId ?? null,
    });
    return NextResponse.json(
      {
        status: 'accepted',
        proof_asset_id: result.proofAssetId,
        consent_status: result.consentStatus,
        usable_in_gate: result.usableInGate,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/product/proof-suggestions POST', error);
  }
}
