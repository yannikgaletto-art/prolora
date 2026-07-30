import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import {
  getWriterPolicy,
  WRITER_MIGRATION_PENDING,
} from '@/lib/writer/policy';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();
    const [policy, pending, activeDna] = await Promise.all([
      getWriterPolicy(workspaceId),
      db
        .from('writer_review_bundles')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending'),
      db
        .from('content_dna_profiles')
        .select('id, version, sample_count')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; version: number; sample_count: number }>(),
    ]);
    if (pending.error) {
      if (isMissingSchemaError(pending.error.code)) throw WRITER_MIGRATION_PENDING;
      throw new Error(`Writer status review count failed: ${pending.error.message}`);
    }
    if (activeDna.error) {
      if (isMissingSchemaError(activeDna.error.code)) throw WRITER_MIGRATION_PENDING;
      throw new Error(`Writer status DNA lookup failed: ${activeDna.error.message}`);
    }
    return NextResponse.json({
      policy,
      pending_review_count: pending.count ?? 0,
      dna_profile: activeDna.data
        ? {
            id: activeDna.data.id,
            version: activeDna.data.version,
            sample_count: activeDna.data.sample_count,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError('v1/writer/status GET', error);
  }
}
