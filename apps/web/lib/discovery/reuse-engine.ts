import type { ReuseRequest, ReuseResponse } from '@prolora/shared';
import { getServiceDb, type DiscoveryCommunityRow, type OpportunityThreadRow } from '@/lib/db';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { checkCooldown } from './cooldown-tracker';

const SIMILARITY_LIMIT = 0.8;

// Content recycling with MANDATORY differentiation (FABLE-04 Abschnitt 8):
// copy-paste across communities reads as spam — new title and new opening
// are non-negotiable, similarity to the original is embedding-checked.
export async function reuseContent(
  workspaceId: string,
  request: ReuseRequest
): Promise<ReuseResponse> {
  const db = getServiceDb();

  const community = await loadCommunity(workspaceId, request.target_community);
  const warnings: string[] = [];

  // Cooldown 1: original younger than 14 days?
  if (request.original_post_id) {
    const { data: original } = await db
      .from('opportunity_threads')
      .select('posted_at_confirmed')
      .eq('id', request.original_post_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle<{ posted_at_confirmed: string | null }>();
    if (original?.posted_at_confirmed) {
      const ageDays = (Date.now() - new Date(original.posted_at_confirmed).getTime()) / 86_400_000;
      if (ageDays < 14) {
        warnings.push(
          `Der Originalpost ist erst ${Math.floor(ageDays)} Tage alt — empfohlen sind mindestens 14 Tage Abstand.`
        );
      }
    }
  }

  // Cooldown 2: weekly posting budget of the target community.
  const cooldown = await checkCooldown(workspaceId, request.target_community);
  if (cooldown.warning) warnings.push(cooldown.warning);

  // Adapt, then verify differentiation via embeddings (up to 2 attempts).
  let adapted = await adaptOnce(request, community, 1);
  let similarity = await cosineToOriginal(request.original_content, adapted.adapted_content);

  if (similarity !== null && similarity > SIMILARITY_LIMIT) {
    adapted = await adaptOnce(request, community, 2);
    similarity = await cosineToOriginal(request.original_content, adapted.adapted_content);
    if (similarity !== null && similarity > SIMILARITY_LIMIT) {
      warnings.push(
        `Adaptierter Content ist dem Original noch sehr ähnlich (Similarity ${similarity.toFixed(2)}) — Winkel stärker ändern.`
      );
    }
  }

  // Similar content already posted in the target community?
  const postedSimilarity = await maxSimilarityToPosted(
    workspaceId,
    request.target_community,
    adapted.adapted_content
  );
  if (postedSimilarity !== null && postedSimilarity > SIMILARITY_LIMIT) {
    warnings.push(
      `In ${request.target_community} wurde bereits sehr ähnlicher Content gepostet (Similarity ${postedSimilarity.toFixed(2)}).`
    );
  }

  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'content_reuse',
    credits_used: 1,
    metadata: {
      target_community: request.target_community,
      similarity_to_original: similarity,
    },
  });
  if (usageError) {
    console.error('[reuse-engine] usage log failed:', usageError.message);
  }

  return {
    adapted_title: adapted.adapted_title,
    adapted_content: adapted.adapted_content,
    differences_from_original: adapted.differences_from_original,
    recommended_posting_time: adapted.recommended_posting_time,
    ...(warnings.length > 0 ? { cooldown_warning: warnings.join(' ') } : {}),
  };
}

interface AdaptedContent {
  adapted_title: string;
  adapted_content: string;
  differences_from_original: string;
  recommended_posting_time: string;
}

async function adaptOnce(
  request: ReuseRequest,
  community: DiscoveryCommunityRow | null,
  attempt: number
): Promise<AdaptedContent> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2500,
    system:
      'Du recycelst Community-Content für eine andere Community. Pflicht: ANDERER Titel, ANDERER Einstieg, ' +
      'gleicher Kern aus neuem Blickwinkel, angepasst an die Zielcommunity. Kein Marketing-Sprech.' +
      (attempt > 1
        ? ' STRIKT: Der letzte Versuch war zu nah am Original — formuliere deutlich eigenständiger, andere Struktur, andere Beispiele.'
        : ''),
    messages: [
      {
        role: 'user',
        content:
          `Original-Content:\n${request.original_content.slice(0, 6000)}\n\n` +
          `Ziel-Community: ${request.target_community}\n` +
          (community?.rules_summary ? `Community-Regeln: ${community.rules_summary}\n` : '') +
          (community?.recommended_approach ? `Empfohlener Ansatz: ${community.recommended_approach}\n` : '') +
          `Gewünschter Winkel-Shift: ${request.angle_shift}`,
      },
    ],
    tools: [
      {
        name: 'reuse_content',
        description: 'Return the adapted content',
        input_schema: {
          type: 'object' as const,
          properties: {
            adapted_title: { type: 'string' },
            adapted_content: { type: 'string' },
            differences_from_original: {
              type: 'string',
              description: 'Diff report: what changed and why',
            },
            recommended_posting_time: {
              type: 'string',
              description: 'e.g. "Dienstag 9-11 Uhr CET — hohe Aktivität in dieser Community"',
            },
          },
          required: [
            'adapted_title',
            'adapted_content',
            'differences_from_original',
            'recommended_posting_time',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'reuse_content' },
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('[reuse-engine] no tool_use block in adaptation response');
  }
  const raw = block.input as Record<string, unknown>;
  const content = typeof raw.adapted_content === 'string' ? raw.adapted_content.trim() : '';
  const title = typeof raw.adapted_title === 'string' ? raw.adapted_title.trim() : '';
  if (!content || !title) {
    throw new Error('[reuse-engine] adaptation returned empty title/content');
  }

  return {
    adapted_title: title,
    adapted_content: content,
    differences_from_original:
      typeof raw.differences_from_original === 'string' ? raw.differences_from_original : '',
    recommended_posting_time:
      typeof raw.recommended_posting_time === 'string' ? raw.recommended_posting_time : '',
  };
}

// null = embeddings not configured -> similarity checks are skipped.
async function cosineToOriginal(original: string, adapted: string): Promise<number | null> {
  const [a, b] = await Promise.all([generateEmbedding(original), generateEmbedding(adapted)]);
  if (!a || !b) return null;
  return cosineSimilarity(a, b);
}

async function maxSimilarityToPosted(
  workspaceId: string,
  communityName: string,
  adaptedContent: string
): Promise<number | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('opportunity_threads')
    .select('posted_content')
    .eq('workspace_id', workspaceId)
    .eq('community_name', communityName)
    .eq('status', 'posted')
    .not('posted_content', 'is', null)
    .order('posted_at_confirmed', { ascending: false })
    .limit(5)
    .returns<Array<Pick<OpportunityThreadRow, 'posted_content'>>>();
  if (error || !data || data.length === 0) return null;

  const adaptedEmbedding = await generateEmbedding(adaptedContent);
  if (!adaptedEmbedding) return null;

  let max: number | null = null;
  for (const row of data) {
    if (!row.posted_content) continue;
    const postedEmbedding = await generateEmbedding(row.posted_content);
    if (!postedEmbedding) continue;
    const similarity = cosineSimilarity(adaptedEmbedding, postedEmbedding);
    if (max === null || similarity > max) max = similarity;
  }
  return max;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

async function loadCommunity(
  workspaceId: string,
  communityName: string
): Promise<DiscoveryCommunityRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('discovery_communities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('community_name', communityName)
    .maybeSingle<DiscoveryCommunityRow>();
  if (error) {
    console.error('[reuse-engine] community lookup failed:', error.message);
    return null;
  }
  return data;
}
