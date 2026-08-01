import type { ProductMentionDecision, ProductMentionMode } from './types';

export interface ProductMentionInput {
  mode: ProductMentionMode;
  platform: string;
  productRelevant: boolean;
  hasSupportingFact: boolean;
  communityRulesKnown: boolean;
  recentMentionRate: number;
}

const omit = (reason: string, confidence: number, ruleIds: string[]): ProductMentionDecision => ({
  decision: 'omit', reason, placement: null, confidence, ruleIds,
});

export function decideProductMention(input: ProductMentionInput): ProductMentionDecision {
  if (input.mode === 'exclude') {
    return omit('The user explicitly excluded product mentions.', 1, ['user_exclude']);
  }
  if (['reddit', 'discord'].includes(input.platform) && !input.communityRulesKnown) {
    return omit(
      'Community promotion rules are unknown, so the conservative default applies.',
      0.95,
      ['community_rules_unknown']
    );
  }
  if (!input.productRelevant) {
    return omit('The product is not substantively relevant to this topic.', 0.9, ['not_relevant']);
  }
  if (!input.hasSupportingFact) {
    return omit('No confirmed fact supports a concrete product reference.', 0.95, ['missing_fact']);
  }
  if (input.mode === 'adaptive' && input.recentMentionRate >= 0.35) {
    return omit('Recent product-mention cadence is already high.', 0.85, ['cadence_cap']);
  }
  return {
    decision: 'include',
    reason: input.mode === 'include'
      ? 'The requested mention is relevant, supported, and allowed.'
      : 'A restrained mention is relevant, supported, and below the cadence cap.',
    placement: input.platform === 'reddit' ? 'comment' : 'closing',
    confidence: input.mode === 'include' ? 0.95 : 0.8,
    ruleIds: [input.mode === 'include' ? 'user_include_allowed' : 'adaptive_relevant'],
  };
}
