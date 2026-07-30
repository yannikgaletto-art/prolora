import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  executeWriterRun,
  type WriterRunDependencies,
} from '@/lib/writer/run';

function repairDependencies(alwaysFail = false): WriterRunDependencies {
  let gateAttempt = 0;
  return {
    loadPolicy: vi.fn().mockResolvedValue({
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
      policyVersion: 1,
    }),
    loadUsage: vi.fn().mockResolvedValue({
      reviewsLast24Hours: 0,
      creditsLast7Days: 0,
    }),
    listSignals: vi.fn().mockResolvedValue([
      {
        id: 'signal-1',
        kind: 'unused_proof',
        title: 'Signal',
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
      version: 1,
      promptVersion: 'writer-v1',
    }),
    loadProofs: vi.fn().mockResolvedValue([
      {
        id: 'proof-1',
        type: 'metric',
        content: 'Proof',
        consentStatus: 'granted',
        verifiedAt: null,
      },
    ]),
    createItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
    transitionItem: vi.fn().mockResolvedValue(undefined),
    generateConcept: vi.fn().mockResolvedValue({
      title: 'Concept',
      angle: 'Angle',
      canonicalContent: 'Canonical',
      structureLabel: null,
      promptVersion: 'writer-v1',
    }),
    generateVariants: vi.fn().mockImplementation(async () => [
      {
        id: 'variant-1',
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        format: 'post',
        content: `Attempt ${gateAttempt}`,
        segments: [],
        structure: {},
        proofAssetIds: ['proof-1'],
      },
    ]),
    evaluateVariant: vi.fn().mockImplementation(async () => {
      gateAttempt += 1;
      const passed = !alwaysFail && gateAttempt === 4;
      return {
        passed,
        findings: passed
          ? []
          : [
              {
                check: 'deterministic',
                passed: false,
                message: 'Too long',
                remedy: 'shorten',
                span: null,
                status: 'failed',
              },
            ],
        overriddenBy: null,
      };
    }),
    persistGateAttempt: vi.fn().mockResolvedValue(undefined),
    proposeSlot: vi.fn().mockResolvedValue({
      instant: '2026-08-01T08:00:00.000Z',
      timezone: 'Europe/Berlin',
    }),
    createReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
  };
}

describe('Writer repair ceiling', () => {
  test('persists machine remedies and succeeds on the third repair', async () => {
    const deps = repairDependencies();
    const result = await executeWriterRun(
      { workspaceId: 'workspace-1', mode: 'normal' },
      deps
    );

    expect(result.repairAttempts).toBe(3);
    expect(deps.generateVariants).toHaveBeenCalledTimes(4);
    expect(deps.persistGateAttempt).toHaveBeenCalledTimes(4);
    expect(deps.persistGateAttempt).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      'variant-1',
      0,
      expect.objectContaining({ remedies: ['shorten'] })
    );
  });

  test('stops after three repairs and never creates an approval bundle', async () => {
    const deps = repairDependencies(true);
    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, deps)
    ).rejects.toMatchObject({
      status: 409,
      code: 'writer_repair_limit_reached',
    });
    expect(deps.generateVariants).toHaveBeenCalledTimes(4);
    expect(deps.createReview).not.toHaveBeenCalled();
    expect(deps.proposeSlot).not.toHaveBeenCalled();
  });

  test('does not treat duplicate variants as complete destination coverage', async () => {
    const deps = repairDependencies();
    deps.loadTargets = vi.fn().mockResolvedValue([
      {
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        accountId: 'account-1',
        accountName: 'Founder',
        characterLimit: 3000,
        format: 'post',
      },
      {
        channelKey: 'connection-2',
        connectionId: 'connection-2',
        platform: 'x',
        accountId: 'account-2',
        accountName: 'Founder X',
        characterLimit: 280,
        format: 'thread',
      },
    ]);
    deps.loadPolicy = vi.fn().mockResolvedValue({
      ...(await deps.loadPolicy('workspace-1')),
      allowedConnectionIds: ['connection-1', 'connection-2'],
    });
    deps.generateVariants = vi.fn().mockResolvedValue([
      {
        id: 'variant-1',
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        format: 'post',
        content: 'First',
        segments: [],
        structure: {},
        proofAssetIds: ['proof-1'],
      },
      {
        id: 'variant-duplicate',
        channelKey: 'connection-1',
        connectionId: 'connection-1',
        platform: 'linkedin',
        format: 'post',
        content: 'Duplicate',
        segments: [],
        structure: {},
        proofAssetIds: ['proof-1'],
      },
    ]);
    deps.evaluateVariant = vi.fn().mockResolvedValue({
      passed: true,
      findings: [],
      overriddenBy: null,
    });

    await expect(
      executeWriterRun({ workspaceId: 'workspace-1', mode: 'normal' }, deps)
    ).rejects.toMatchObject({ code: 'writer_repair_limit_reached' });
    expect(deps.generateVariants).toHaveBeenCalledTimes(4);
    expect(deps.createReview).not.toHaveBeenCalled();
  });
});

describe('Writer Inngest registration', () => {
  test('registers only an event worker and no cron', () => {
    const client = readFileSync(
      resolve(process.cwd(), 'lib/inngest/client.ts'),
      'utf8'
    );
    const worker = readFileSync(
      resolve(process.cwd(), 'lib/inngest/functions/writer.ts'),
      'utf8'
    );
    const route = readFileSync(
      resolve(process.cwd(), 'app/api/inngest/route.ts'),
      'utf8'
    );
    expect(client).toContain(`'writer/run'`);
    expect(worker).toContain(`{ event: 'writer/run' }`);
    expect(worker).not.toMatch(/cron:/);
    expect(route).toContain('writerRun');
  });
});
