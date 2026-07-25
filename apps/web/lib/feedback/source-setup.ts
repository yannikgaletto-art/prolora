import { getServiceDb, type FeedbackSourceRow } from '@/lib/db';

export function buildWidgetCurl(appUrl: string, workspaceSlug: string): string {
  const base = appUrl.replace(/\/$/, '');
  const payload = JSON.stringify({
    workspace: workspaceSlug,
    content: 'The onboarding was clear, but exporting reports could be faster.',
    rating: 4,
  });
  return [
    `curl -X POST '${base}/api/v1/feedback/widget' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${payload}'`,
  ].join('\n');
}

// The Listen empty-state copy used to live here as hardcoded strings — one
// German, one English, on the same screen. It now comes from the locale
// dictionary (lib/i18n/run7.ts, `listen.empty*`); which of the three cases
// applies is decided in the page from hasFilters / hasAnyFeedback /
// anySourceConnected.

export async function getFeedbackSources(workspaceId: string): Promise<FeedbackSourceRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_sources')
    .select('id, workspace_id, source_type, config, status, last_polled_at, last_poll_cursor, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .returns<FeedbackSourceRow[]>();
  if (error) throw new Error(`[feedback:sources] query failed: ${error.message}`);
  return data ?? [];
}
