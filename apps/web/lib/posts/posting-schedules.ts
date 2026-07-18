import { ApiError } from '@/lib/api/http';
import { getServiceDb, type PostingScheduleRow, type PostItemRow } from '@/lib/db';
import { allocateNextSlot, type AllocatedSlot } from './slot-allocator';
import { buildSeedSlots, type ScheduleFrequency } from './schedule-seeding';

export async function nextFreePostingSlot(input: {
  workspaceId: string;
  connectionIds: string[];
  now?: Date;
}): Promise<AllocatedSlot | null> {
  const db = getServiceDb();
  const connectionIds = [...new Set(input.connectionIds)];
  const { data: connections, error: connectionError } = await db
    .from('platform_connections')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .in('id', connectionIds)
    .returns<Array<{ id: string }>>();
  if (connectionError) throw new Error(`[posting-schedules] connection lookup failed: ${connectionError.message}`);
  if ((connections ?? []).length !== connectionIds.length) {
    throw new ApiError(404, 'One or more connections were not found.', 'connection_not_found');
  }

  const ids = connectionIds.join(',');
  const { data: slots, error: slotsError } = await db
    .from('posting_schedules')
    .select('id, workspace_id, connection_id, day_of_week, local_time, timezone, is_active')
    .eq('workspace_id', input.workspaceId)
    .eq('is_active', true)
    .or(`connection_id.is.null,connection_id.in.(${ids})`)
    .returns<PostingScheduleRow[]>();
  if (slotsError) throw new Error(`[posting-schedules] slot lookup failed: ${slotsError.message}`);

  const { data: occupied, error: occupiedError } = await db
    .from('post_items')
    .select('connection_id, status, post_groups!inner(workspace_id, scheduled_at)')
    .in('connection_id', connectionIds)
    // A draft with scheduled_at is a human-held reservation (Splinter accept).
    // Count it as occupied so several accepted drafts spread across slots,
    // while its draft status still prevents the publish sweep from touching it.
    .in('status', ['draft', 'scheduled', 'queued'])
    .eq('post_groups.workspace_id', input.workspaceId)
    .not('post_groups.scheduled_at', 'is', null)
    .returns<Array<Pick<PostItemRow, 'connection_id' | 'status'> & {
      post_groups: { workspace_id: string; scheduled_at: string | null };
    }>>();
  if (occupiedError) throw new Error(`[posting-schedules] occupancy lookup failed: ${occupiedError.message}`);

  return allocateNextSlot({
    slots: slots ?? [],
    occupiedInstants: (occupied ?? [])
      .map((row) => row.post_groups.scheduled_at)
      .filter((value): value is string => Boolean(value)),
    now: input.now ?? new Date(),
  });
}

export async function seedPostingSchedule(input: {
  workspaceId: string;
  connectionId: string;
  frequency: ScheduleFrequency;
  timezone: string;
}): Promise<{ source: 'metrics' | 'fallback'; created: number; active: number; warning: string | null }> {
  const db = getServiceDb();
  const { data: connection, error: connectionError } = await db
    .from('platform_connections')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.connectionId)
    .maybeSingle<{ id: string }>();
  if (connectionError) throw new Error(`[posting-schedules] connection lookup failed: ${connectionError.message}`);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'connection_not_found');

  const { data: published, error: publishedError } = await db
    .from('post_items')
    .select('published_at, metrics')
    .eq('connection_id', input.connectionId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(500)
    .returns<Array<{ published_at: string | null; metrics: Record<string, unknown> | null }>>();
  if (publishedError) throw new Error(`[posting-schedules] metrics lookup failed: ${publishedError.message}`);

  const plan = buildSeedSlots({
    frequency: input.frequency,
    timezone: input.timezone,
    published: published ?? [],
  });
  const { data: previous, error: previousError } = await db
    .from('posting_schedules')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('connection_id', input.connectionId)
    .eq('is_active', true)
    .returns<Array<{ id: string }>>();
  if (previousError) throw new Error(`[posting-schedules] old-plan lookup failed: ${previousError.message}`);

  const { data: inserted, error: insertError } = await db.from('posting_schedules').insert(
    plan.slots.map((slot) => ({
      workspace_id: input.workspaceId,
      connection_id: input.connectionId,
      timezone: input.timezone,
      is_active: true,
      ...slot,
    }))
  ).select('id').returns<Array<{ id: string }>>();
  if (insertError || (inserted ?? []).length !== plan.slots.length) {
    throw new Error(`[posting-schedules] plan insert failed: ${insertError?.message ?? 'incomplete insert'}`);
  }

  const previousIds = (previous ?? []).map((row) => row.id);
  if (previousIds.length > 0) {
    const { error: deactivateError } = await db
      .from('posting_schedules')
      .update({ is_active: false })
      .in('id', previousIds);
    if (deactivateError) {
      console.error('[posting-schedules] old plan remains active:', deactivateError.message);
    }
  }

  const { count, error: countError } = await db
    .from('posting_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', input.workspaceId)
    .eq('connection_id', input.connectionId)
    .eq('is_active', true);
  if (countError) throw new Error(`[posting-schedules] plan verification failed: ${countError.message}`);
  const active = count ?? 0;
  if (active < plan.slots.length) throw new Error('[posting-schedules] plan verification returned too few active slots');
  return {
    source: plan.source,
    created: plan.slots.length,
    active,
    warning: active > 5 ? 'More than 5 active slots per week may reduce post quality.' : null,
  };
}
