import { NextRequest, NextResponse } from 'next/server';
import { proofAssetCreateSchema } from '@prolora/shared';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { confirmFact, listFactsAt } from '@/lib/product/facts';
import { createProofAsset, listProofAssets } from '@/lib/product/profile';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

const factValueSchema = z.union([
  z.object({ number: z.number().finite() }).strict(),
  z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ boolean: z.boolean() }).strict(),
]);

const factCreateSchema = z.object({
  type: z.enum(['metric', 'customer_quote', 'founder_observation', 'case_study', 'experiment']),
  content: z.string().trim().min(3).max(2000),
  source_url: z.string().url().nullish(),
  fact_key: z.string().trim().min(3).max(200).regex(/^[a-z0-9_.-]+$/),
  fact_kind: z.enum(['current_state', 'historical_state', 'event', 'metric', 'financial', 'policy']),
  fact_value: factValueSchema,
  fact_unit: z.string().trim().min(1).max(100).nullish(),
  effective_from: z.string().datetime(),
  direction_policy: z.enum(['free', 'warn_on_decrease', 'warn_on_increase']).default('free'),
  fact_change_reason: z.string().trim().min(3).max(1000).nullish(),
});

// GET/POST /api/v1/product/proof-assets (GOAL-RUN9 §6 T0.2).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const asOf = req.nextUrl.searchParams.get('as_of') ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(asOf))) {
      return jsonError(400, 'as_of must be an ISO timestamp.', 'invalid_request');
    }
    const [assets, facts] = await Promise.all([
      listProofAssets(auth.workspaceId),
      listFactsAt(auth.workspaceId, asOf),
    ]);
    return NextResponse.json({ proof_assets: assets, facts, as_of: asOf });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    if (typeof body === 'object' && body !== null && 'fact_key' in body) {
      const manager = await requireWriterOwnerOrAdmin(auth);
      const input = factCreateSchema.parse(body);
      const fact = await confirmFact(auth.workspaceId, {
        type: input.type,
        content: input.content,
        sourceUrl: input.source_url,
        factKey: input.fact_key,
        factKind: input.fact_kind,
        value: input.fact_value,
        unit: input.fact_unit,
        effectiveFrom: input.effective_from,
        directionPolicy: input.direction_policy,
        changeReason: input.fact_change_reason,
      }, manager.userId);
      return NextResponse.json({ fact }, { status: 201 });
    }
    const input = proofAssetCreateSchema.parse(body);
    const asset = await createProofAsset(auth.workspaceId, input);
    return NextResponse.json({ proof_asset: asset }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets POST', error);
  }
}
