// Calendar read model (GOAL-RUN6 Phase 2). Bounded range query on
// scheduled_at (NOT created_at — authoring time is not publish time), plus a
// separate bucket for unscheduled drafts. group_status is a precedence rollup
// that drives the calendar dot color.
import { getServiceDb, type MediaRef, type PostGroupRow, type PostItemRow } from '@/lib/db';

// Calendar grids overscan a 6-week month; 62 days caps abuse while covering
// any month view. Result cap keeps the payload bounded (no pagination — the
// range IS the page).
export const MAX_RANGE_DAYS = 62;
export const MAX_CALENDAR_GROUPS = 500;

export type CalendarGroupStatus =
  | 'failed'
  | 'publishing'
  | 'queued'
  | 'scheduled'
  | 'draft'
  | 'published'
  | 'deleted';

export interface CalendarItem {
  post_item_id: string;
  connection_id: string;
  platform: PostItemRow['platform'];
  status: PostItemRow['status'];
  platform_url: string | null;
  error_message: string | null;
}

export interface CalendarGroup {
  post_group_id: string;
  scheduled_at: string | null;
  scheduled_tz: string | null;
  content_preview: string;
  first_comment: string | null;
  media_count: number;
  created_via: PostGroupRow['created_via'];
  content_source_id: string | null;
  group_status: CalendarGroupStatus;
  items: CalendarItem[];
}

export interface CalendarResponse {
  groups: CalendarGroup[];
  /** Unscheduled drafts (scheduled_at IS NULL) for the side rail. */
  drafts: CalendarGroup[];
  truncated: boolean;
}

// Precedence: something needing attention wins over everything routine.
const STATUS_PRECEDENCE: CalendarGroupStatus[] = [
  'failed',
  'publishing',
  'queued',
  'scheduled',
  'draft',
  'published',
  'deleted',
];

/** Pure — unit-tested. Empty item lists roll up to 'deleted' (nothing live). */
export function rollupGroupStatus(statuses: PostItemRow['status'][]): CalendarGroupStatus {
  for (const status of STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status;
  }
  return 'deleted';
}

/** Pure — validates a from/to range. Returns an error string or null. */
export function validateCalendarRange(from: string, to: string): string | null {
  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) return 'from/to must be valid ISO timestamps';
  if (toTs <= fromTs) return 'to must be after from';
  if (toTs - fromTs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return `Range exceeds ${MAX_RANGE_DAYS} days — narrow the window`;
  }
  return null;
}

interface GroupWithItems extends PostGroupRow {
  post_items: PostItemRow[];
}

function toCalendarGroup(row: GroupWithItems): CalendarGroup {
  const items = (row.post_items ?? []).map((item) => ({
    post_item_id: item.id,
    connection_id: item.connection_id,
    platform: item.platform,
    status: item.status,
    platform_url: item.platform_url,
    error_message: item.error_message,
  }));
  return {
    post_group_id: row.id,
    scheduled_at: row.scheduled_at,
    scheduled_tz: row.scheduled_tz,
    content_preview:
      row.original_content.length > 140
        ? `${row.original_content.slice(0, 140)}…`
        : row.original_content,
    first_comment: row.first_comment,
    media_count: (row.media as MediaRef[] | null)?.length ?? 0,
    created_via: row.created_via,
    content_source_id: row.content_source_id,
    group_status: rollupGroupStatus(items.map((i) => i.status)),
    items,
  };
}

export async function getCalendar(
  workspaceId: string,
  from: string,
  to: string
): Promise<CalendarResponse> {
  const db = getServiceDb();

  // Range bucket: everything with a scheduled_at inside the window
  // (Invariante 2: workspace-scoped service-role query).
  const { data: rangeRows, error: rangeError } = await db
    .from('post_groups')
    .select('*, post_items(*)')
    .eq('workspace_id', workspaceId)
    .gte('scheduled_at', from)
    .lte('scheduled_at', to)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_CALENDAR_GROUPS + 1)
    .returns<GroupWithItems[]>();
  if (rangeError) {
    throw new Error(`[calendar] range query failed: ${rangeError.message}`);
  }

  // Draft rail: unscheduled groups whose items are (still) drafts.
  const { data: draftRows, error: draftError } = await db
    .from('post_groups')
    .select('*, post_items!inner(*)')
    .eq('workspace_id', workspaceId)
    .is('scheduled_at', null)
    .eq('post_items.status', 'draft')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<GroupWithItems[]>();
  if (draftError) {
    throw new Error(`[calendar] draft query failed: ${draftError.message}`);
  }

  const truncated = (rangeRows ?? []).length > MAX_CALENDAR_GROUPS;
  const groups = (rangeRows ?? [])
    .slice(0, MAX_CALENDAR_GROUPS)
    .map(toCalendarGroup)
    // Groups where every item was deleted disappear from the calendar.
    .filter((g) => g.group_status !== 'deleted');

  return {
    groups,
    drafts: (draftRows ?? []).map(toCalendarGroup),
    truncated,
  };
}
