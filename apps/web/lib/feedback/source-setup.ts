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

export function listenEmptyState(hasSources: boolean): {
  title: string;
  description: string;
  showSourceSetup: boolean;
} {
  return hasSources
    ? {
        title: 'No feedback matches these filters',
        description: 'Try widening your filters, or check back once new feedback arrives.',
        showSourceSetup: false,
      }
    : {
        title: 'Noch keine Quelle verbunden',
        description: 'Starte mit dem Feedback-Widget — es braucht keinen API-Key und ist in etwa zwei Minuten eingerichtet.',
        showSourceSetup: true,
      };
}

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
