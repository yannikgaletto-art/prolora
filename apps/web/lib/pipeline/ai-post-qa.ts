import { ApiError } from '@/lib/api/http';
import { NARRATIVE_GATE_VERSION } from './qa-snapshot';
import { sha256Hex } from '@/lib/writer/hash';
import { resolveGenerationContext } from '@/lib/generation/context';

interface QaGenerationRecord {
  factsHash?: unknown;
  sampleHash?: unknown;
  platform?: unknown;
  category?: unknown;
}

interface AiQaContext {
  origin?: unknown;
  contentHash?: unknown;
  gateStatus?: unknown;
  gateVersion?: unknown;
  generation?: QaGenerationRecord;
  language?: unknown;
}

export async function assertAiPostQaFreshForWorkspace(input: AiPostQaInput & {
  workspaceId: string;
  platform: string;
}): Promise<void> {
  if (!input.qaContext || !['writer', 'ai'].includes(String(input.qaContext.origin))) {
    assertAiPostQaFresh(input);
    return;
  }
  const context = input.qaContext as AiQaContext;
  const generation = context.generation;
  const language = context.language === 'en' ? 'en' : context.language === 'de' ? 'de' : null;
  if (!generation || !language) {
    assertAiPostQaFresh(input);
    return;
  }
  const current = await resolveGenerationContext(input.workspaceId, {
    language,
    platform: input.platform,
    category: typeof generation.category === 'string' ? generation.category : null,
    asOf: new Date().toISOString(),
    mentionMode: 'exclude',
    productRelevant: false,
    communityRulesKnown: true,
  });
  assertAiPostQaFresh({
    ...input,
    currentFactsHash: current.factsHash,
    currentSampleHash: current.sampleHash,
  });
}

export interface AiPostQaInput {
  resolvedContent: string;
  qaContext: Record<string, unknown> | null | undefined;
  currentFactsHash?: string;
  currentSampleHash?: string;
}

export function assertAiPostQaFresh(input: AiPostQaInput): void {
  if (!input.qaContext) return;
  const context = input.qaContext as AiQaContext;
  if (context.origin !== 'writer' && context.origin !== 'ai') return;
  const generation = context.generation;
  const stale =
    context.gateStatus !== 'passed' ||
    context.gateVersion !== NARRATIVE_GATE_VERSION ||
    context.contentHash !== sha256Hex(input.resolvedContent) ||
    typeof generation !== 'object' ||
    generation === null ||
    typeof generation.factsHash !== 'string' ||
    typeof generation.sampleHash !== 'string' ||
    (input.currentFactsHash !== undefined && generation.factsHash !== input.currentFactsHash) ||
    (input.currentSampleHash !== undefined && generation.sampleHash !== input.currentSampleHash);
  if (stale) {
    throw new ApiError(
      409,
      'This generated post needs fresh QA before it can be scheduled or published.',
      'ai_post_qa_stale'
    );
  }
}
