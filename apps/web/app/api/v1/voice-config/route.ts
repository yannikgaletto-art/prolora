import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type VoiceConfigRow } from '@/lib/db';

async function loadOrCreateDefault(workspaceId: string): Promise<VoiceConfigRow> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('voice_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('name', 'default')
    .maybeSingle<VoiceConfigRow>();
  if (error) {
    throw new Error(`[voice-config] lookup failed: ${error.message}`);
  }
  if (data) return data;

  const { data: created, error: insertError } = await db
    .from('voice_configs')
    .insert({ workspace_id: workspaceId, name: 'default' })
    .select('*')
    .single<VoiceConfigRow>();
  if (insertError || !created) {
    throw new Error(`[voice-config] default creation failed: ${insertError?.message ?? 'no row'}`);
  }
  return created;
}

// GET /api/v1/voice-config — the workspace's default voice
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const config = await loadOrCreateDefault(workspaceId);
    return NextResponse.json({ voice_config: config });
  } catch (error) {
    return handleRouteError('v1/voice-config GET', error);
  }
}

const patchSchema = z.object({
  tone: z.enum(['casual', 'professional', 'technical', 'empathetic']).optional(),
  language: z.string().min(2).max(8).optional(),
  max_reply_length: z.number().int().min(50).max(5000).optional(),
  include_personal_experience: z.boolean().optional(),
  avoid_patterns: z.array(z.string().max(100)).max(20).optional(),
  example_replies: z.array(z.string().max(2000)).max(10).optional(),
});

// PATCH /api/v1/voice-config — update the default voice
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const patch = patchSchema.parse(body);
    if (Object.keys(patch).length === 0) {
      return jsonError(400, 'No fields to update.', 'empty_patch');
    }

    const current = await loadOrCreateDefault(workspaceId);
    const db = getServiceDb();
    const { data: updated, error } = await db
      .from('voice_configs')
      .update(patch)
      .eq('id', current.id)
      .select('*')
      .single<VoiceConfigRow>();
    if (error || !updated) {
      throw new Error(`[voice-config] update failed: ${error?.message ?? 'no row'}`);
    }

    return NextResponse.json({ voice_config: updated });
  } catch (error) {
    return handleRouteError('v1/voice-config PATCH', error);
  }
}
