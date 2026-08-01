import type { PlatformType } from '@prolora/shared';
import { ApiError } from '@/lib/api/http';
import { checkProofBinding, type GateFinding } from '@/lib/pipeline/quality-gate';
import { runNarrativeChecks } from '@/lib/pipeline/narrative-judge';
import { resolveGenerationContext } from './context';
import type { GenerationContext, OutputLanguage, ProductMentionMode } from './types';

export interface ManualGenerationPolicy {
  language: OutputLanguage;
  mentionMode: ProductMentionMode;
}

export async function resolveManualGenerationContexts(
  workspaceId: string,
  platforms: readonly string[],
  policy: ManualGenerationPolicy,
  options: { category?: string | null; productRelevant?: boolean; communityRulesKnown?: boolean } = {}
): Promise<GenerationContext[]> {
  const asOf = new Date().toISOString();
  return Promise.all([...new Set(platforms)].map((platform) => resolveGenerationContext(workspaceId, {
    language: policy.language,
    platform,
    category: options.category,
    asOf,
    mentionMode: policy.mentionMode,
    productRelevant: options.productRelevant ?? true,
    communityRulesKnown: options.communityRulesKnown ?? true,
  })));
}

export function renderGroundedContext(contexts: readonly GenerationContext[]): string {
  return contexts.map((context) => [
    `Context for ${context.platform}:`,
    `- required output language: ${context.language}`,
    `- product mention: ${context.mention.decision}; ${context.mention.reason}`,
    ...context.promptRules.map((rule) => `- style rule: ${rule.instruction}`),
    ...context.samples.map((sample) => `- masked style sample (structure only; never copy): ${sample.maskedContent}`),
    ...context.facts.map((fact) =>
      `- confirmed fact valid at ${context.asOf}: ${fact.factKey} = ${JSON.stringify(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`
    ),
  ].join('\n')).join('\n\n');
}

export async function assertGroundedDraft(
  content: string,
  context: GenerationContext,
  _platform?: PlatformType | string
): Promise<GateFinding[]> {
  const proof = checkProofBinding({
    content,
    proofAssets: context.facts.map((fact) => ({
      id: fact.id,
      type: fact.factKind,
      content: `${fact.factKey} ${JSON.stringify(fact.value)} ${fact.unit ?? ''}`,
      consentStatus: 'owner',
    })),
    locale: context.language,
  });
  const narrative = await runNarrativeChecks(content, {
    language: context.language,
    mention: context.mention,
    facts: context.facts,
    samples: context.samples,
    semanticJudgeRequired: false,
  });
  const findings = [proof, ...narrative.findings];
  const failed = findings.filter((finding) => finding.status === 'failed');
  if (failed.length > 0) {
    throw new ApiError(
      409,
      `Draft failed narrative QA: ${failed.map((finding) => finding.message).join(' ')}`,
      'narrative_qa_failed'
    );
  }
  return findings;
}
