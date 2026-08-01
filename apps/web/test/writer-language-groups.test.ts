import { describe, expect, test, vi } from 'vitest';
import {
  executeWriterLanguages,
  type WriterRunDependencies,
  type WriterRunPolicy,
} from '@/lib/writer/run';

const policy: WriterRunPolicy = {
  enabled: true, mode: 'approval_required', allowedConnectionIds: ['connection-1'],
  dailyPostCap: 2, weeklyCreditCap: 100, minimumSignalStrength: 0.5,
  contentMix: {}, quietDays: [], timezone: 'Europe/Berlin', dnaProfileId: 'dna-1',
  outputLanguages: ['de', 'en'], productMentionMode: 'exclude', policyVersion: 1,
};

const dependencies = (): WriterRunDependencies => ({
  loadPolicy: vi.fn().mockResolvedValue(policy),
  loadUsage: vi.fn().mockResolvedValue({ reviewsLast24Hours: 0, creditsLast7Days: 0 }),
  listSignals: vi.fn().mockResolvedValue([{ id: 'signal-1', kind: 'feedback_theme', title: 'Signal', strength: 0.9, staleAfter: null, createdAt: '2026-08-01T08:00:00.000Z', evidence: { proofAssetIds: [], feedbackItemIds: [], communityIds: [], referenceIds: [] } }]),
  loadTargets: vi.fn().mockResolvedValue([{ channelKey: 'connection-1', connectionId: 'connection-1', platform: 'linkedin', accountId: 'account-1', accountName: 'Founder', characterLimit: 3000, format: 'post' }]),
  loadDna: vi.fn().mockResolvedValue({ profileId: 'dna-1', version: 1, promptVersion: 'v1' }),
  loadProofs: vi.fn().mockResolvedValue([]),
  createItem: vi.fn().mockImplementation(async ({ language }) => ({ id: `item-${language}` })),
  transitionItem: vi.fn().mockResolvedValue(undefined),
  generateConcept: vi.fn().mockImplementation(async ({ language }) => ({ title: 'Concept', angle: 'Angle', canonicalContent: `Content ${language}`, structureLabel: 'story', promptVersion: 'v1' })),
  generateVariants: vi.fn().mockImplementation(async ({ contentItemId, language }) => [{ id: `variant-${language}`, channelKey: 'connection-1', connectionId: 'connection-1', platform: 'linkedin', format: 'post', content: `Variant ${language}`, segments: [], structure: {}, proofAssetIds: [], contentItemId }]),
  evaluateVariant: vi.fn().mockResolvedValue({ passed: true, findings: [], overriddenBy: null }),
  persistGateAttempt: vi.fn().mockResolvedValue(undefined),
  proposeSlot: vi.fn().mockResolvedValue({ instant: '2026-08-02T08:00:00.000Z', timezone: 'Europe/Berlin' }),
  createReview: vi.fn().mockImplementation(async ({ snapshot }) => ({ id: `review-${snapshot.contentItem.id}` })),
});

describe('Writer language siblings', () => {
  test('creates one content item per language under one generation group', async () => {
    const deps = dependencies();
    const results = await executeWriterLanguages(
      { workspaceId: 'workspace-1', mode: 'normal', languages: ['de', 'en'] },
      deps,
      new Date('2026-08-01T10:00:00.000Z'),
      '11111111-1111-4111-8111-111111111111'
    );

    expect(results.map((result) => result.language)).toEqual(['de', 'en']);
    expect(deps.createItem).toHaveBeenNthCalledWith(1, expect.objectContaining({ language: 'de', generationGroupId: '11111111-1111-4111-8111-111111111111' }));
    expect(deps.createItem).toHaveBeenNthCalledWith(2, expect.objectContaining({ language: 'en', generationGroupId: '11111111-1111-4111-8111-111111111111' }));
    expect(deps.generateConcept).toHaveBeenNthCalledWith(1, expect.objectContaining({ language: 'de' }));
    expect(deps.generateConcept).toHaveBeenNthCalledWith(2, expect.objectContaining({ language: 'en' }));
  });

  test('threads the resolved language/platform context into generation and gate evaluation', async () => {
    const deps = dependencies();
    const context = {
      language: 'de' as const, platform: 'linkedin', asOf: '2026-08-01T10:00:00.000Z',
      samples: [], facts: [], history: [], promptRules: [],
      mention: { decision: 'omit' as const, reason: 'excluded', placement: null, confidence: 1, ruleIds: [] },
      sampleHash: 'samples', factsHash: 'facts', promptVersion: 'generation-context-v1' as const,
    };
    deps.loadGenerationContext = vi.fn().mockResolvedValue(context);

    await executeWriterLanguages(
      { workspaceId: 'workspace-1', mode: 'normal', languages: ['de'] },
      deps,
      new Date('2026-08-01T10:00:00.000Z'),
      '11111111-1111-4111-8111-111111111111'
    );

    expect(deps.generateConcept).toHaveBeenCalledWith(expect.objectContaining({ contexts: [context] }));
    expect(deps.generateVariants).toHaveBeenCalledWith(expect.objectContaining({ contexts: [context] }));
    expect(deps.evaluateVariant).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), context);
  });
});
