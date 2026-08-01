import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/http';
import {
  executeWriterRun,
  type WriterRunDependencies,
  type WriterRunPolicy,
} from '@/lib/writer/run';

const policy: WriterRunPolicy = {
  enabled: true,
  mode: 'approval_required',
  allowedConnectionIds: ['connection-1'],
  dailyPostCap: 1,
  weeklyCreditCap: 10,
  minimumSignalStrength: 0.6,
  contentMix: {},
  quietDays: [],
  timezone: 'Europe/Berlin',
  dnaProfileId: 'dna-1',
  outputLanguages: ['de'],
  productMentionMode: 'adaptive',
  policyVersion: 2,
};

function dependencies(
  overrides: Partial<WriterRunDependencies> = {}
): WriterRunDependencies {
  return {
    loadPolicy: vi.fn().mockResolvedValue(policy),
    loadUsage: vi.fn().mockResolvedValue({
      reviewsLast24Hours: 0,
      creditsLast7Days: 0,
    }),
    listSignals: vi.fn().mockResolvedValue([
      {
        id: 'signal-weaker',
        kind: 'feedback_theme',
        title: 'Weaker',
        strength: 0.7,
        staleAfter: null,
        createdAt: '2026-07-29T10:00:00.000Z',
        evidence: {
          proofAssetIds: [],
          feedbackItemIds: ['feedback-2'],
          communityIds: [],
          referenceIds: [],
        },
      },
      {
        id: 'signal-stronger',
        kind: 'unused_proof',
        title: 'Stronger grounded signal',
        strength: 0.9,
        staleAfter: null,
        createdAt: '2026-07-30T10:00:00.000Z',
        evidence: {
          proofAssetIds: ['proof-1'],
          feedbackItemIds: [],
          communityIds: [],
          referenceIds: [],
        },
      },
    ]),
    loadTargets: vi.fn().mockResolvedValue([
      {
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        accountId: 'account-1',
        accountName: 'Founder',
        characterLimit: 3000,
        format: 'post',
      },
    ]),
    loadDna: vi.fn().mockResolvedValue({
      profileId: 'dna-1',
      version: 3,
      promptVersion: 'writer-v1',
    }),
    loadProofs: vi.fn().mockResolvedValue([
      {
        id: 'proof-1',
        type: 'metric',
        content: 'Activation improved.',
        consentStatus: 'granted',
        verifiedAt: '2026-07-29T10:00:00.000Z',
      },
    ]),
    createItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
    transitionItem: vi.fn().mockResolvedValue(undefined),
    generateConcept: vi.fn().mockResolvedValue({
      title: 'One recommendation',
      angle: 'Evidence first',
      canonicalContent: 'Canonical content',
      structureLabel: 'analysis',
      promptVersion: 'writer-v1',
    }),
    generateVariants: vi.fn().mockResolvedValue([
      {
        id: 'variant-1',
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        format: 'post',
        content: 'Exact LinkedIn copy',
        segments: [],
        structure: { mechanism: 'grounded' },
        proofAssetIds: ['proof-1'],
      },
    ]),
    evaluateVariant: vi.fn().mockResolvedValue({
      passed: true,
      findings: [],
      overriddenBy: null,
    }),
    persistGateAttempt: vi.fn().mockResolvedValue(undefined),
    proposeSlot: vi.fn().mockResolvedValue({
      instant: '2026-08-01T08:00:00.000Z',
      timezone: 'Europe/Berlin',
    }),
    createReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
    ...overrides,
  };
}

describe('bounded Writer run', () => {
  test('selects one signal and one concept, then stops at immutable approval', async () => {
    const deps = dependencies();
    const result = await executeWriterRun(
      { workspaceId: 'workspace-1', mode: 'normal' },
      deps,
      new Date('2026-07-30T12:00:00.000Z')
    );

    expect(result).toMatchObject({
      contentItemId: 'item-1',
      reviewBundleId: 'review-1',
      state: 'awaiting_approval',
      repairAttempts: 0,
    });
    expect(deps.createItem).toHaveBeenCalledTimes(1);
    expect(deps.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ signalRef: 'signal-stronger' })
    );
    expect(deps.generateConcept).toHaveBeenCalledTimes(1);
    expect(deps.createReview).toHaveBeenCalledTimes(1);
    expect(deps.transitionItem).toHaveBeenLastCalledWith(
      'item-1',
      'awaiting_approval',
      expect.any(Object)
    );
    expect(deps.transitionItem).not.toHaveBeenCalledWith(
      expect.anything(),
      'scheduled',
      expect.anything()
    );
  });

  test('honors pause unless the user explicitly requests shadow mode', async () => {
    const normal = dependencies({
      loadPolicy: vi.fn().mockResolvedValue({ ...policy, enabled: false }),
    });
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, normal)
    ).rejects.toMatchObject({ status: 409, code: 'writer_paused' } satisfies Partial<ApiError>);
    expect(normal.listSignals).not.toHaveBeenCalled();

    const shadow = dependencies({
      loadPolicy: vi.fn().mockResolvedValue({ ...policy, enabled: false }),
    });
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'shadow' }, shadow)
    ).resolves.toMatchObject({ state: 'awaiting_approval' });
  });

  test.each([
    [
      'daily',
      { reviewsLast24Hours: 1, creditsLast7Days: 0 },
      'daily_writer_cap_reached',
    ],
    [
      'weekly',
      { reviewsLast24Hours: 0, creditsLast7Days: 10 },
      'weekly_writer_credit_cap_reached',
    ],
  ])('checks the %s cap before generation', async (_name, usage, code) => {
    const deps = dependencies({
      loadUsage: vi.fn().mockResolvedValue(usage),
    });
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, deps)
    ).rejects.toMatchObject({ status: 409, code });
    expect(deps.listSignals).not.toHaveBeenCalled();
    expect(deps.generateConcept).not.toHaveBeenCalled();
  });

  test('returns an item to drafted if immutable review creation fails', async () => {
    const deps = dependencies({
      createReview: vi.fn().mockRejectedValue(new Error('review insert failed')),
    });
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, deps)
    ).rejects.toThrow('review insert failed');
    expect(deps.transitionItem).toHaveBeenLastCalledWith(
      'item-1',
      'drafted',
      expect.objectContaining({
        reason: expect.stringMatching(/review creation failed/i),
      })
    );
  });

  test('stops before generation when a selected proof loses usable consent', async () => {
    const deps = dependencies({
      loadProofs: vi.fn().mockResolvedValue([]),
    });
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, deps)
    ).rejects.toMatchObject({
      status: 409,
      code: 'writer_proof_context_changed',
    });
    expect(deps.createItem).not.toHaveBeenCalled();
    expect(deps.generateConcept).not.toHaveBeenCalled();
  });
});
