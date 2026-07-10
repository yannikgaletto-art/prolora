import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type OpportunityThreadRow } from '@/lib/db';
import { recordPost } from '@/lib/discovery/cooldown-tracker';

const confirmSchema = z.object({
  actual_content: z.string().max(20000).optional(),
  posted_url: z.string().url().optional(),
});

// POST /api/v1/discover/:id/confirm — the user confirms THEY posted.
// This is a PURE STATUS UPDATE. No Reddit/X/etc. API call happens here —
// Prolora never creates posts on communities (Invariante D1).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const input = confirmSchema.parse(body ?? {});

    const db = getServiceDb();
    const { data: thread, error } = await db
      .from('opportunity_threads')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle<OpportunityThreadRow>();
    if (error) {
      throw new Error(`[discover/confirm] lookup failed: ${error.message}`);
    }
    if (!thread) {
      return jsonError(404, 'Opportunity not found.', 'not_found');
    }
    if (thread.status === 'posted') {
      return jsonError(409, 'Already confirmed as posted.', 'already_posted');
    }

    const { error: updateError } = await db
      .from('opportunity_threads')
      .update({
        status: 'posted',
        posted_content: input.actual_content ?? thread.draft_content,
        posted_at_confirmed: new Date().toISOString(),
      })
      .eq('id', thread.id);
    if (updateError) {
      throw new Error(`[discover/confirm] update failed: ${updateError.message}`);
    }

    // Read-back verify (Double Assurance).
    const { data: verify, error: verifyError } = await db
      .from('opportunity_threads')
      .select('status')
      .eq('id', thread.id)
      .single<{ status: string }>();
    if (verifyError || verify?.status !== 'posted') {
      throw new Error('[discover/confirm] status verification failed');
    }

    // Cooldown counter for this community (+1 this week).
    await recordPost(workspaceId, thread.community_name);

    return NextResponse.json({
      opportunity_id: thread.id,
      status: 'posted',
      posted_at_confirmed: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError('v1/discover/:id/confirm POST', error);
  }
}
