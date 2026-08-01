import { describe, expect, test } from 'vitest';
import { decideProductMention } from '@/lib/generation/mention';

describe('Pathly mention decision', () => {
  test('exclude is a hard omission', () => {
    expect(decideProductMention({
      mode: 'exclude', platform: 'linkedin', productRelevant: true,
      hasSupportingFact: true, communityRulesKnown: true, recentMentionRate: 0,
    })).toMatchObject({ decision: 'omit', confidence: 1, ruleIds: ['user_exclude'] });
  });

  test('unknown community rules default to omission even when include was requested', () => {
    expect(decideProductMention({
      mode: 'include', platform: 'reddit', productRelevant: true,
      hasSupportingFact: true, communityRulesKnown: false, recentMentionRate: 0,
    })).toMatchObject({ decision: 'omit', ruleIds: expect.arrayContaining(['community_rules_unknown']) });
  });

  test('adaptive mode omits irrelevant or over-frequent promotion', () => {
    expect(decideProductMention({
      mode: 'adaptive', platform: 'linkedin', productRelevant: false,
      hasSupportingFact: true, communityRulesKnown: true, recentMentionRate: 0,
    }).decision).toBe('omit');
    expect(decideProductMention({
      mode: 'adaptive', platform: 'linkedin', productRelevant: true,
      hasSupportingFact: true, communityRulesKnown: true, recentMentionRate: 0.5,
    }).decision).toBe('omit');
  });

  test('includes a relevant, supported mention with a placement', () => {
    expect(decideProductMention({
      mode: 'adaptive', platform: 'linkedin', productRelevant: true,
      hasSupportingFact: true, communityRulesKnown: true, recentMentionRate: 0.1,
    })).toMatchObject({ decision: 'include', placement: 'closing' });
  });
});
