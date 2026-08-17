// One context resolver prevents Writer, templates, and community drafts from
// drifting into different truth/style policies. Sample loaders never select raw content.
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { listFactsAt, type ConfirmedFact } from '@/lib/product/facts';
import { retrieveGoldenSamples, type RetrievableSample } from '@/lib/writer/golden-bundle';
import { hashCanonicalJson } from '@/lib/writer/hash';
import type { DnaPromptRule } from '@/lib/writer/types';
import { decideProductMention } from './mention';
import type {
  GenerationContext,
  OutputLanguage,
  ProductMentionMode,
  PublishedHistoryEntry,
} from './types';

export interface ResolveGenerationInput {
  language: OutputLanguage;
  platform: string;
  category?: string | null;
  asOf: string;
  mentionMode: ProductMentionMode;
  productRelevant: boolean;
  communityRulesKnown: boolean;
  recentSampleIds?: string[];
}

export interface GenerationContextDependencies {
  loadSamples(workspaceId: string): Promise<RetrievableSample[]>;
  loadFacts(workspaceId: string, asOf: string): Promise<ConfirmedFact[]>;
  loadHistory(workspaceId: string, asOf: string): Promise<PublishedHistoryEntry[]>;
  loadPromptRules(workspaceId: string): Promise<DnaPromptRule[]>;
}

interface SamplePromptRow {
  id: string;
  kind: 'golden' | 'avoid';
  active: boolean;
  platform: string | null;
  category: string | null;
  hook_type: string | null;
  content_format: string | null;
  masked_content: string | null;
  content_hash: string;
}

async function loadSamples(workspaceId: string): Promise<RetrievableSample[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .select('id, kind, active, platform, category, hook_type, content_format, masked_content, content_hash')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .returns<SamplePromptRow[]>();
  // Schema-drift guard: migrations 021/023 not live yet ⇒ no samples, no 500.
  if (error && isMissingSchemaError(error.code)) return [];
  if (error) throw new Error(`[generation-context] sample lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    active: row.active,
    platform: row.platform,
    category: row.category,
    hookType: row.hook_type,
    contentFormat: row.content_format,
    maskedContent: row.masked_content ?? '',
    contentHash: row.content_hash,
  }));
}

async function loadHistory(workspaceId: string, asOf: string): Promise<PublishedHistoryEntry[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('id, resolved_content, published_at, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', workspaceId)
    .eq('status', 'published')
    .lte('published_at', asOf)
    .order('published_at', { ascending: false })
    .limit(50)
    .returns<Array<{ id: string; resolved_content: string | null; published_at: string | null }>>();
  if (error) throw new Error(`[generation-context] history lookup failed: ${error.message}`);
  return (data ?? []).flatMap((row) => row.resolved_content && row.published_at ? [{
    id: row.id, content: row.resolved_content, publishedAt: row.published_at,
  }] : []);
}

async function loadPromptRules(workspaceId: string): Promise<DnaPromptRule[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_dna_profiles')
    .select('prompt_rules')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .maybeSingle<{ prompt_rules: DnaPromptRule[] }>();
  // Schema-drift guard (Ursache des /publish/prepare-500ers am 2026-08-17):
  // `content_dna_profiles` (Migration 021) ist live noch nicht angewendet.
  // Ohne DNA-Profil gibt es schlicht keine gelernten Regeln — kein Fehler.
  if (error && isMissingSchemaError(error.code)) return [];
  if (error) throw new Error(`[generation-context] DNA lookup failed: ${error.message}`);
  return data?.prompt_rules ?? [];
}

const defaultDependencies: GenerationContextDependencies = {
  loadSamples,
  loadFacts: listFactsAt,
  loadHistory,
  loadPromptRules,
};

const recentMentionRate = (history: readonly PublishedHistoryEntry[]): number => {
  if (history.length === 0) return 0;
  const mentions = history.filter((entry) => /\bpathly\b/iu.test(entry.content)).length;
  return mentions / history.length;
};

export async function resolveGenerationContext(
  workspaceId: string,
  input: ResolveGenerationInput,
  dependencies: GenerationContextDependencies = defaultDependencies
): Promise<GenerationContext> {
  const [allSamples, facts, history, promptRules] = await Promise.all([
    dependencies.loadSamples(workspaceId),
    dependencies.loadFacts(workspaceId, input.asOf),
    dependencies.loadHistory(workspaceId, input.asOf),
    dependencies.loadPromptRules(workspaceId),
  ]);
  const samples = retrieveGoldenSamples(allSamples, {
    platform: input.platform,
    category: input.category ?? null,
    recentSampleIds: input.recentSampleIds,
  });
  const mention = decideProductMention({
    mode: input.mentionMode,
    platform: input.platform,
    productRelevant: input.productRelevant,
    hasSupportingFact: facts.length > 0,
    communityRulesKnown: input.communityRulesKnown,
    recentMentionRate: recentMentionRate(history),
  });
  const sampleHash = hashCanonicalJson(samples.map((sample) => ({
    id: sample.id,
    contentHash: sample.contentHash,
    maskedContent: sample.maskedContent,
    platform: sample.platform,
    category: sample.category,
    hookType: sample.hookType,
  })));
  const factsHash = hashCanonicalJson(facts.map((fact) => ({
    id: fact.id,
    factKey: fact.factKey,
    value: fact.value,
    unit: fact.unit,
    effectiveFrom: fact.effectiveFrom,
    effectiveTo: fact.effectiveTo,
  })));

  return {
    language: input.language,
    platform: input.platform,
    category: input.category ?? null,
    asOf: input.asOf,
    samples,
    facts,
    history,
    promptRules,
    mention,
    sampleHash,
    factsHash,
    promptVersion: 'generation-context-v1',
  };
}

export async function resolveGenerationContexts(
  workspaceId: string,
  input: Omit<ResolveGenerationInput, 'language'> & { languages: OutputLanguage[] },
  dependencies: GenerationContextDependencies = defaultDependencies
): Promise<GenerationContext[]> {
  return Promise.all(input.languages.map((language) => resolveGenerationContext(
    workspaceId,
    { ...input, language },
    dependencies
  )));
}
