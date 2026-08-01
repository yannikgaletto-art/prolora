// Beschafft die Zahlen für den geführten Faden (`steps.ts`).
//
// Diese Funktion läuft im Dashboard-Layout, also auf JEDER Seite. Zwei
// Konsequenzen, die den Code prägen:
//
// 1. Nur zählende Abfragen (`head: true`), nie Zeilen laden. Der Faden braucht
//    "gibt es welche?", nicht "welche sind es".
// 2. Kein einziger Fehler darf nach oben durchschlagen. Die Migrationen 019–022
//    liegen im Repo, sind aber nicht zwangsläufig live — eine fehlende Tabelle
//    muss den Faden degradieren, nicht das Dashboard abschießen.
//
// Invariante 2: jede Abfrage ist explizit auf `workspace_id` gefiltert.
// `post_items` trägt selbst keine `workspace_id`, deshalb der Join über
// `post_groups!inner` — dasselbe Muster wie die Quota-Zählung in
// `lib/posts/create-post.ts`.
import { getServiceDb } from '@/lib/db';
import type { GuideState } from './steps';

type ItemStatus = 'draft' | 'queued' | 'scheduled' | 'published';

/** Zählt `post_items` eines Workspaces in einem Status. -1 bei Fehler. */
async function countItems(workspaceId: string, statuses: ItemStatus[]): Promise<number> {
  const db = getServiceDb();
  const { count, error } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)', { count: 'exact', head: true })
    .eq('post_groups.workspace_id', workspaceId)
    .in('status', statuses);
  if (error) {
    console.error(`[guide] post_items count (${statuses.join(',')}) failed:`, error.message);
    return 0;
  }
  return count ?? 0;
}

async function countActiveConnections(workspaceId: string): Promise<number> {
  const db = getServiceDb();
  const { count, error } = await db
    .from('platform_connections')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (error) {
    console.error('[guide] connection count failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

async function hasProductProfile(workspaceId: string): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspace_contexts')
    .select('product_description')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ product_description: string | null }>();
  if (error) {
    console.error('[guide] product profile lookup failed:', error.message);
    return false;
  }
  return Boolean(data?.product_description?.trim());
}

/**
 * Wartende Writer-Freigaben. Der Rückgabewert unterscheidet bewusst zwischen
 * "Tabelle fehlt" und "nichts wartet" — im ersten Fall blendet `resolveGuide`
 * den Freigabe-Schritt komplett aus, statt ihn dauerhaft als erledigt zu zeigen.
 */
async function countAwaitingApproval(
  workspaceId: string
): Promise<{ available: boolean; count: number }> {
  const db = getServiceDb();
  const { count, error } = await db
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('state', 'awaiting_approval');
  if (error) {
    // Migration 020/022 nicht live → Writer existiert für diesen Nutzer nicht.
    console.error('[guide] writer probe failed (migration pending?):', error.message);
    return { available: false, count: 0 };
  }
  return { available: true, count: count ?? 0 };
}

/** Ein vollständig leerer Zustand — der Faden startet dann bei Schritt 1. */
const EMPTY_STATE: GuideState = {
  hasProduct: false,
  activeConnections: 0,
  awaitingApproval: 0,
  writerAvailable: false,
  drafts: 0,
  scheduled: 0,
  published: 0,
};

export async function loadGuideState(workspaceId: string): Promise<GuideState> {
  try {
    const [hasProduct, activeConnections, writer, drafts, scheduled, published] =
      await Promise.all([
        hasProductProfile(workspaceId),
        countActiveConnections(workspaceId),
        countAwaitingApproval(workspaceId),
        countItems(workspaceId, ['draft', 'queued']),
        countItems(workspaceId, ['scheduled']),
        countItems(workspaceId, ['published']),
      ]);

    return {
      hasProduct,
      activeConnections,
      awaitingApproval: writer.count,
      writerAvailable: writer.available,
      drafts,
      scheduled,
      published,
    };
  } catch (error) {
    // Die Einzelabfragen fangen ihre Fehler bereits selbst ab; das hier ist der
    // Rückfall für alles Unerwartete (z. B. fehlende Service-Role-Konfiguration).
    console.error('[guide] state load failed:', error);
    return EMPTY_STATE;
  }
}
