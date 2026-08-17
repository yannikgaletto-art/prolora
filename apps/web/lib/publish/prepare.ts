// GOAL-RUN11 One Path: ein Aufruf komponiert Draft + Kanal-Default + Slot aus
// bestehenden Bausteinen. Kein neuer Publishing-Code — veröffentlicht wird
// weiterhin nur über POST /v1/posts nach explizitem Nutzer-Klick (RUN9 D4).
import type { ConceptLens, PlatformType, PostConcept } from '@prolora/shared';
import { DEFAULT_CONCEPT_SETTINGS } from '@prolora/shared';
import { generateConcepts } from '@/lib/content/concept-service';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import {
  getConnectionsWithCharacterLimits,
  type ConnectionWithLimit,
} from '@/lib/connections/list-connections';
import { nextFreePostingSlot } from '@/lib/posts/posting-schedules';

/** Platforms the concept pipeline can write for (conceptRequestSchema subset). */
const CONCEPT_PLATFORMS: ReadonlySet<PlatformType> = new Set([
  'linkedin',
  'x',
  'bluesky',
  'mastodon',
  'telegram',
]);

export interface PreparedDraft {
  lens: ConceptLens;
  title: string;
  content: string;
  rationale: string;
}

export interface PrepareResult {
  draft: PreparedDraft | null;
  /** The two unused concepts — "Nochmal anders" swaps without a new credit. */
  alternatives: PreparedDraft[];
  /** Present instead of a draft when the raw material was too thin. */
  follow_up_questions: string[];
  connections: ConnectionWithLimit[];
  suggested_slot: { instant: string; timezone: string } | null;
  credits_used: number;
}

/** Pure: unique concept-capable platforms of active connections, LinkedIn fallback. */
export function derivePlatforms(
  connections: Pick<ConnectionWithLimit, 'platform' | 'status'>[]
): PlatformType[] {
  const platforms = new Set<PlatformType>();
  for (const connection of connections) {
    if (connection.status === 'active' && CONCEPT_PLATFORMS.has(connection.platform)) {
      platforms.add(connection.platform);
    }
  }
  return platforms.size > 0 ? [...platforms] : ['linkedin'];
}

const RISK_ORDER: Record<PostConcept['risk_flag'], number> = { low: 0, medium: 1, high: 2 };

/** Pure: lowest-risk concept wins, ties keep the service's original order. */
export function pickBestConcept(concepts: PostConcept[]): PostConcept | null {
  let best: PostConcept | null = null;
  for (const concept of concepts) {
    if (best === null || RISK_ORDER[concept.risk_flag] < RISK_ORDER[best.risk_flag]) {
      best = concept;
    }
  }
  return best;
}

function toDraft(concept: PostConcept): PreparedDraft {
  return {
    lens: concept.lens,
    title: concept.title,
    content: concept.canonical_content,
    rationale: concept.rationale,
  };
}

export async function preparePost(
  workspaceId: string,
  input: { topic: string; output_language?: 'de' | 'en' }
): Promise<PrepareResult> {
  const [connections, context] = await Promise.all([
    getConnectionsWithCharacterLimits(workspaceId),
    getWorkspaceContext(workspaceId).catch(() => null),
  ]);

  const targetPlatforms = derivePlatforms(connections);
  const language =
    input.output_language ?? (context?.voice_language?.trim() === 'en' ? 'en' : 'de');

  // 'authority' is the neutral default lens set for a free-text topic — the
  // guided flow (/publish/start) stays the place to pick goals deliberately.
  const response = await generateConcepts(workspaceId, {
    content_goal: 'authority',
    user_idea: input.topic,
    settings: DEFAULT_CONCEPT_SETTINGS,
    target_platforms: targetPlatforms,
    output_language: language,
    product_mention_mode: 'adaptive',
  });

  const best = pickBestConcept(response.concepts);
  const alternatives = response.concepts.filter((concept) => concept !== best).map(toDraft);

  // The slot is a suggestion, never a blocker — any failure degrades to "now".
  let suggestedSlot: PrepareResult['suggested_slot'] = null;
  const activeIds = connections
    .filter((connection) => connection.status === 'active')
    .map((connection) => connection.connection_id);
  if (activeIds.length > 0) {
    try {
      suggestedSlot = await nextFreePostingSlot({ workspaceId, connectionIds: activeIds });
    } catch (error) {
      console.error('[onepath] slot suggestion failed:', error);
    }
  }

  return {
    draft: best ? toDraft(best) : null,
    alternatives,
    follow_up_questions: response.follow_up_questions ?? [],
    connections,
    suggested_slot: suggestedSlot,
    credits_used: response.credits_used,
  };
}
