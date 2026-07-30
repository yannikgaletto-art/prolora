import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  getWriterPolicy,
  requireWriterOwnerOrAdmin,
  updateWriterPolicy,
} from '@/lib/writer/policy';

const policyPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowed_connection_ids: z.array(z.string().uuid()).max(20).optional(),
    daily_post_cap: z.number().int().min(1).max(20).optional(),
    weekly_credit_cap: z.number().int().min(1).max(500).optional(),
    minimum_signal_strength: z.number().min(0).max(1).optional(),
    content_mix: z.record(z.number().min(0).max(1)).optional(),
    quiet_days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    dna_profile_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one policy field is required.',
  });

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const policy = await getWriterPolicy(await getWorkspaceId(req));
    return NextResponse.json({ policy });
  } catch (error) {
    return handleRouteError('v1/writer/policy GET', error);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const { userId } = await requireWriterOwnerOrAdmin(auth);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = policyPatchSchema.parse(body);
    const policy = await updateWriterPolicy(
      auth.workspaceId,
      {
        enabled: input.enabled,
        allowedConnectionIds: input.allowed_connection_ids,
        dailyPostCap: input.daily_post_cap,
        weeklyCreditCap: input.weekly_credit_cap,
        minimumSignalStrength: input.minimum_signal_strength,
        contentMix: input.content_mix,
        quietDays: input.quiet_days,
        timezone: input.timezone,
        dnaProfileId: input.dna_profile_id,
      },
      userId
    );
    return NextResponse.json({ policy });
  } catch (error) {
    return handleRouteError('v1/writer/policy PATCH', error);
  }
}
