import type { ConfirmedFact } from '@/lib/product/facts';
import type { DnaPromptRule } from '@/lib/writer/types';
import type { RetrievedGoldenSample } from '@/lib/writer/golden-bundle';

export type OutputLanguage = 'de' | 'en';
export type ProductMentionMode = 'adaptive' | 'include' | 'exclude';

export interface ProductMentionDecision {
  decision: 'include' | 'omit';
  reason: string;
  placement: 'body' | 'closing' | 'comment' | null;
  confidence: number;
  ruleIds: string[];
}

export interface PublishedHistoryEntry {
  id: string;
  content: string;
  publishedAt: string;
}

export interface GenerationContext {
  language: OutputLanguage;
  platform: string;
  category?: string | null;
  asOf: string;
  samples: RetrievedGoldenSample[];
  facts: ConfirmedFact[];
  history: PublishedHistoryEntry[];
  promptRules: DnaPromptRule[];
  mention: ProductMentionDecision;
  sampleHash: string;
  factsHash: string;
  promptVersion: 'generation-context-v1';
}
