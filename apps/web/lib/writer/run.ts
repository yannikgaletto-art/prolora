import {
  CREDIT_COSTS,
  DEFAULT_CONCEPT_SETTINGS,
  type ContentGoal,
  type PlatformType,
  type PostConcept,
} from '@prolora/shared';
import { ApiError } from '@/lib/api/http';
import { generateConcepts } from '@/lib/content/concept-service';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { listGateUsableProofAssets } from '@/lib/feedback/proof-extraction';
import { listSignals, type SignalKind } from '@/lib/pipeline/inventory';
import {
  estimateChannelNativeCredits,
  generateChannelNativeVariants,
  type ChannelFormat,
} from '@/lib/pipeline/channel-native';
import {
  gateResultToJson,
  runQualityGate,
  type GateRemedy,
  type GateResult,
} from '@/lib/pipeline/quality-gate';
import { resolveChannelTargets } from '@/lib/pipeline/orchestrator';
import {
  createContentItem,
  saveVariantGateResult,
  transitionContentItem,
  upsertVariant,
  type MixBucket,
  type TransitionPatch,
} from '@/lib/pipeline/state';
import { nextFreePostingSlot } from '@/lib/posts/posting-schedules';
import { sha256Hex } from './hash';
import { getWriterPolicy, type WriterPolicy } from './policy';
import { createWriterReview, type WriterReviewSnapshotInput } from './reviews';
import { getContentDna } from './samples';

export type WriterRunPolicy = WriterPolicy;
export type WriterRunMode = 'normal' | 'shadow';

export interface WriterRunSignal {
  id: string;
  kind: SignalKind;
  title: string;
  strength: number;
  staleAfter: string | null;
  createdAt: string;
  evidence: {
    proofAssetIds: string[];
    feedbackItemIds: string[];
    communityIds: string[];
    referenceIds: string[];
  };
}

export interface WriterRunTarget {
  channelKey: string;
  connectionId: string;
  platform: string;
  accountId: string | null;
  accountName: string;
  characterLimit: number;
  format: ChannelFormat;
}

export interface WriterRunDna {
  profileId: string;
  version: number;
  promptVersion: string;
}

export interface WriterRunProof {
  id: string;
  type: string;
  content: string;
  consentStatus: string;
  verifiedAt: string | null;
}

export interface WriterRunConcept {
  title: string;
  angle: string;
  canonicalContent: string;
  structureLabel: string | null;
  promptVersion: string;
}

export interface WriterRunVariant {
  id: string;
  channelKey: string;
  connectionId: string;
  platform: string;
  format: ChannelFormat;
  content: string;
  segments: string[];
  structure: Record<string, string> | null;
  proofAssetIds: string[];
}

export interface WriterRunUsage {
  reviewsLast24Hours: number;
  creditsLast7Days: number;
}

export interface WriterGateAttempt {
  gate: GateResult;
  remedies: Exclude<GateRemedy, null>[];
}

export interface WriterRunDependencies {
  loadPolicy(workspaceId: string): Promise<WriterRunPolicy>;
  loadUsage(workspaceId: string, now: Date): Promise<WriterRunUsage>;
  listSignals(workspaceId: string, minimumStrength: number): Promise<WriterRunSignal[]>;
  loadTargets(workspaceId: string): Promise<WriterRunTarget[]>;
  loadDna(workspaceId: string, profileId: string | null): Promise<WriterRunDna>;
  loadProofs(workspaceId: string, ids: string[]): Promise<WriterRunProof[]>;
  createItem(input: {
    workspaceId: string;
    signalRef: string;
    signal: WriterRunSignal;
    mixBucket: MixBucket;
  }): Promise<{ id: string }>;
  transitionItem(
    itemId: string,
    state:
      | 'angled'
      | 'concepted'
      | 'drafted'
      | 'gated'
      | 'awaiting_approval',
    detail: {
      workspaceId: string;
      reason: string;
      metadata?: Record<string, unknown>;
      patch?: TransitionPatch;
    }
  ): Promise<void>;
  generateConcept(input: {
    workspaceId: string;
    signal: WriterRunSignal;
    targets: WriterRunTarget[];
    mixBucket: MixBucket;
    dna: WriterRunDna;
  }): Promise<WriterRunConcept>;
  generateVariants(input: {
    workspaceId: string;
    contentItemId: string;
    concept: WriterRunConcept;
    targets: WriterRunTarget[];
    proofs: WriterRunProof[];
    repairAttempt: number;
    remedies: Exclude<GateRemedy, null>[];
  }): Promise<WriterRunVariant[]>;
  evaluateVariant(
    variant: WriterRunVariant,
    proofs: WriterRunProof[]
  ): Promise<GateResult>;
  persistGateAttempt(
    workspaceId: string,
    variantId: string,
    repairAttempt: number,
    attempt: WriterGateAttempt
  ): Promise<void>;
  proposeSlot(
    workspaceId: string,
    connectionIds: string[],
    now: Date
  ): Promise<{ instant: string; timezone: string } | null>;
  createReview(input: {
    workspaceId: string;
    snapshot: WriterReviewSnapshotInput;
    expiresAt: string;
  }): Promise<{ id: string }>;
}

export interface WriterRunResult {
  contentItemId: string;
  reviewBundleId: string;
  state: 'awaiting_approval';
  proposedSlot: {
    scheduledAt: string;
    timezone: string;
  };
  repairAttempts: number;
}

const MAX_REPAIR_ATTEMPTS = 3;
const REVIEW_TTL_MS = 72 * 60 * 60 * 1000;

const GOAL_BY_BUCKET: Record<MixBucket, ContentGoal> = {
  insight: 'authority',
  proof: 'productEducation',
  story: 'personalStory',
  question: 'community',
};

export function mixBucketForWriterSignal(kind: SignalKind): MixBucket {
  if (kind === 'unused_proof') return 'proof';
  if (kind === 'community_question') return 'question';
  if (kind === 'splinter') return 'story';
  return 'insight';
}

export function rankWriterSignals(
  signals: readonly WriterRunSignal[],
  now: Date,
  contentMix: Record<string, number> = {}
): WriterRunSignal[] {
  return signals
    .filter((signal) => {
      const staleAt = signal.staleAfter ? new Date(signal.staleAfter).getTime() : null;
      return staleAt === null || !Number.isFinite(staleAt) || staleAt > now.getTime();
    })
    .map((signal) => ({
      signal,
      score:
        signal.strength +
        (signal.evidence.proofAssetIds.length > 0 ? 0.05 : 0) +
        Math.max(0, contentMix[mixBucketForWriterSignal(signal.kind)] ?? 0) * 0.1 +
        Math.max(
          0,
          0.01 -
            Math.max(0, now.getTime() - new Date(signal.createdAt).getTime()) /
              (365 * 24 * 60 * 60 * 1000)
        ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.signal.id.localeCompare(right.signal.id)
    )
    .map(({ signal }) => signal);
}

function uniqueRemedies(gateResults: readonly GateResult[]): Exclude<GateRemedy, null>[] {
  return [
    ...new Set(
      gateResults.flatMap((result) =>
        result.findings
          .map((finding) => finding.remedy)
          .filter((remedy): remedy is Exclude<GateRemedy, null> => remedy !== null)
      )
    ),
  ].sort();
}

function writerGateResultJson(
  gate: GateResult,
  repairAttempt: number
): Record<string, unknown> {
  return {
    ...gateResultToJson(gate),
    writerRepairAttempt: repairAttempt,
    remedies: uniqueRemedies([gate]),
  };
}

export async function executeWriterRun(
  input: { workspaceId: string; mode: WriterRunMode },
  dependencies: WriterRunDependencies,
  now: Date = new Date()
): Promise<WriterRunResult> {
  const policy = await dependencies.loadPolicy(input.workspaceId);
  if (!policy.enabled && input.mode !== 'shadow') {
    throw new ApiError(409, 'Writer is paused for this workspace.', 'writer_paused');
  }

  const usage = await dependencies.loadUsage(input.workspaceId, now);
  if (usage.reviewsLast24Hours >= policy.dailyPostCap) {
    throw new ApiError(
      409,
      'The daily Writer cap has been reached.',
      'daily_writer_cap_reached'
    );
  }
  if (usage.creditsLast7Days >= policy.weeklyCreditCap) {
    throw new ApiError(
      409,
      'The weekly Writer credit cap has been reached.',
      'weekly_writer_credit_cap_reached'
    );
  }

  const signals = await dependencies.listSignals(
    input.workspaceId,
    policy.minimumSignalStrength
  );
  const signal = rankWriterSignals(signals, now, policy.contentMix)[0];
  if (!signal) {
    throw new ApiError(409, 'No fresh Writer signal meets the policy.', 'no_writer_signal');
  }

  const allTargets = await dependencies.loadTargets(input.workspaceId);
  const targets = allTargets.filter((target) =>
    policy.allowedConnectionIds.includes(target.connectionId)
  );
  if (targets.length === 0) {
    throw new ApiError(
      409,
      'Writer has no active allowed destination.',
      'no_writer_destination'
    );
  }
  const nativeCredits = estimateChannelNativeCredits({
      conceptCount: 1,
      channelCount: targets.length,
    }).credits;
  // Reserve the complete bounded path before the first charge: one initial
  // generation plus at most three repairs.
  const projectedCredits =
    CREDIT_COSTS.post_concepts + nativeCredits * (MAX_REPAIR_ATTEMPTS + 1);
  if (usage.creditsLast7Days + projectedCredits > policy.weeklyCreditCap) {
    throw new ApiError(
      409,
      'This run would exceed the weekly Writer credit cap.',
      'weekly_writer_credit_cap_reached'
    );
  }

  const [dna, proofs] = await Promise.all([
    dependencies.loadDna(input.workspaceId, policy.dnaProfileId),
    dependencies.loadProofs(input.workspaceId, signal.evidence.proofAssetIds),
  ]);
  const loadedProofIds = new Set(proofs.map((proof) => proof.id));
  if (
    signal.evidence.proofAssetIds.some((proofId) => !loadedProofIds.has(proofId))
  ) {
    throw new ApiError(
      409,
      'A selected Writer proof is missing or no longer consent-eligible.',
      'writer_proof_context_changed'
    );
  }
  const mixBucket = mixBucketForWriterSignal(signal.kind);
  const item = await dependencies.createItem({
    workspaceId: input.workspaceId,
    signalRef: signal.id,
    signal,
    mixBucket,
  });
  await dependencies.transitionItem(item.id, 'angled', {
    workspaceId: input.workspaceId,
    reason: 'Writer selected the highest-ranked fresh signal.',
    metadata: { signal_ref: signal.id },
    patch: { angle: { title: signal.title, angle: signal.title } },
  });

  const concept = await dependencies.generateConcept({
    workspaceId: input.workspaceId,
    signal,
    targets,
    mixBucket,
    dna,
  });
  await dependencies.transitionItem(item.id, 'concepted', {
    workspaceId: input.workspaceId,
    reason: 'Writer selected one recommended concept.',
    metadata: { prompt_version: concept.promptVersion },
    patch: {
      concept: {
        title: concept.title,
        angle: concept.angle,
        canonical_content: concept.canonicalContent,
        structure_label: concept.structureLabel,
      },
    },
  });

  let repairAttempts = 0;
  let remedies: Exclude<GateRemedy, null>[] = [];
  let variants: WriterRunVariant[] = [];
  let gates: GateResult[] = [];

  for (;;) {
    variants = await dependencies.generateVariants({
      workspaceId: input.workspaceId,
      contentItemId: item.id,
      concept,
      targets,
      proofs,
      repairAttempt: repairAttempts,
      remedies,
    });
    if (repairAttempts === 0) {
      await dependencies.transitionItem(item.id, 'drafted', {
        workspaceId: input.workspaceId,
        reason: 'Writer persisted exact channel-native variants.',
        metadata: { variant_count: variants.length },
      });
    }

    gates = await Promise.all(
      variants.map((variant) => dependencies.evaluateVariant(variant, proofs))
    );
    remedies = uniqueRemedies(gates);
    await Promise.all(
      variants.map((variant, index) =>
        dependencies.persistGateAttempt(input.workspaceId, variant.id, repairAttempts, {
          gate: gates[index],
          remedies: uniqueRemedies([gates[index]]),
        })
      )
    );

    const expectedChannels = new Set(targets.map((target) => target.channelKey));
    const generatedChannels = new Set(variants.map((variant) => variant.channelKey));
    const complete =
      variants.length === targets.length &&
      generatedChannels.size === expectedChannels.size &&
      [...expectedChannels].every((channelKey) => generatedChannels.has(channelKey)) &&
      gates.length === variants.length &&
      gates.every((gate) => gate.passed);
    if (complete) break;
    if (repairAttempts >= MAX_REPAIR_ATTEMPTS) {
      throw new ApiError(
        409,
        'Writer stopped after three bounded repair attempts.',
        'writer_repair_limit_reached'
      );
    }
    repairAttempts += 1;
    await dependencies.transitionItem(item.id, 'drafted', {
      workspaceId: input.workspaceId,
      reason: `Writer repair attempt ${repairAttempts}/${MAX_REPAIR_ATTEMPTS}.`,
      metadata: { repair_attempt: repairAttempts, remedies },
      patch: {
        gateResult: {
          passed: false,
          repairAttempt: repairAttempts,
          remedies,
        },
      },
    });
  }

  await dependencies.transitionItem(item.id, 'gated', {
    workspaceId: input.workspaceId,
    reason: 'All selected Writer variants passed the hard quality gate.',
    metadata: { repair_attempts: repairAttempts },
    patch: { gateResult: { passed: true, repairAttempts } },
  });

  const slot = await dependencies.proposeSlot(
    input.workspaceId,
    targets.map((target) => target.connectionId),
    now
  );
  if (!slot) {
    throw new ApiError(409, 'No posting slot is configured for Writer.', 'no_writer_slot');
  }

  await dependencies.transitionItem(item.id, 'awaiting_approval', {
    workspaceId: input.workspaceId,
    reason: 'Writer review snapshot is ready for explicit human approval.',
    metadata: {
      proposed_slot: slot.instant,
      timezone: slot.timezone,
      repair_attempts: repairAttempts,
    },
  });

  const targetByConnection = new Map(targets.map((target) => [target.connectionId, target]));
  const gateByVariant = new Map(
    variants.map((variant, index) => [variant.id, gates[index]])
  );
  const snapshot: WriterReviewSnapshotInput = {
    contentItem: {
      id: item.id,
      title: signal.title,
      canonicalContent: concept.canonicalContent,
    },
    variants: variants.map((variant) => {
      const target = targetByConnection.get(variant.connectionId);
      if (!target) {
        throw new ApiError(
          409,
          'A Writer variant lost its destination.',
          'approval_context_changed'
        );
      }
      return {
        id: variant.id,
        channelKey: variant.channelKey,
        platform: variant.platform,
        connection: {
          id: target.connectionId,
          platform: target.platform,
          accountId: target.accountId,
          accountName: target.accountName,
        },
        format: variant.format,
        content: variant.content,
        segments: variant.segments,
        media: [],
        firstComment: null,
        proofAssetIds: variant.proofAssetIds,
        gatePassed: gateByVariant.get(variant.id)?.passed === true,
        gateResult: writerGateResultJson(
          gateByVariant.get(variant.id) as GateResult,
          repairAttempts
        ),
      };
    }),
    proposedSlot: { scheduledAt: slot.instant, timezone: slot.timezone },
    sources: {
      proofAssets: proofs.map((proof) => ({
        id: proof.id,
        consentStatus: proof.consentStatus,
        verifiedAt: proof.verifiedAt,
        contentHash: sha256Hex(proof.content),
      })),
      feedbackItemIds: signal.evidence.feedbackItemIds,
      referenceIds: signal.evidence.referenceIds,
    },
    dna: { profileId: dna.profileId, version: dna.version },
    versions: {
      prompt: concept.promptVersion,
      gate: 'quality-gate-v1',
      policy: policy.policyVersion,
    },
  };
  let review: { id: string };
  try {
    review = await dependencies.createReview({
      workspaceId: input.workspaceId,
      snapshot,
      expiresAt: new Date(now.getTime() + REVIEW_TTL_MS).toISOString(),
    });
  } catch (error) {
    await dependencies.transitionItem(item.id, 'drafted', {
      workspaceId: input.workspaceId,
      reason: 'Writer review creation failed; the item was returned for a safe retry.',
      metadata: { repair_attempts: repairAttempts },
    });
    throw error;
  }
  return {
    contentItemId: item.id,
    reviewBundleId: review.id,
    state: 'awaiting_approval',
    proposedSlot: snapshot.proposedSlot,
    repairAttempts,
  };
}

async function loadWriterUsage(workspaceId: string, now: Date): Promise<WriterRunUsage> {
  const db = getServiceDb();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [reviews, usage] = await Promise.all([
    db
      .from('writer_review_bundles')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('created_at', dayStart),
    db
      .from('usage_logs')
      .select('credits_used')
      .eq('workspace_id', workspaceId)
      .gte('created_at', weekStart)
      .limit(1000)
      .returns<Array<{ credits_used: number | null }>>(),
  ]);
  if (reviews.error) {
    if (isMissingSchemaError(reviews.error.code)) {
      throw new ApiError(503, 'Writer storage is not set up.', 'migration_pending');
    }
    throw new Error(`Writer daily usage lookup failed: ${reviews.error.message}`);
  }
  if (usage.error) throw new Error(`Writer credit usage lookup failed: ${usage.error.message}`);
  return {
    reviewsLast24Hours: reviews.count ?? 0,
    creditsLast7Days: (usage.data ?? []).reduce(
      (sum, row) => sum + (row.credits_used ?? 0),
      0
    ),
  };
}

function conceptLensForBucket(bucket: MixBucket): PostConcept['lens'] {
  if (bucket === 'story') return 'founder';
  if (bucket === 'question') return 'community';
  return 'evidence';
}

async function loadUnusedWriterSignals(
  workspaceId: string,
  minimumStrength: number
): Promise<WriterRunSignal[]> {
  const signals = await listSignals(workspaceId, {
    minStrength: minimumStrength,
    limit: 25,
  });
  if (signals.length === 0) return [];
  const { data, error } = await getServiceDb()
    .from('content_items')
    .select('signal_ref')
    .eq('workspace_id', workspaceId)
    .in(
      'signal_ref',
      signals.map((signal) => signal.id)
    )
    .limit(25)
    .returns<Array<{ signal_ref: string | null }>>();
  if (error) {
    if (isMissingSchemaError(error.code)) {
      throw new ApiError(503, 'Writer integrity storage is not set up.', 'migration_pending');
    }
    throw new Error(`Writer signal deduplication failed: ${error.message}`);
  }
  const used = new Set((data ?? []).map((row) => row.signal_ref).filter(Boolean));
  return signals.filter((signal) => !used.has(signal.id));
}

const defaultDependencies: WriterRunDependencies = {
  loadPolicy: getWriterPolicy,
  loadUsage: loadWriterUsage,
  listSignals: loadUnusedWriterSignals,
  loadTargets: async (workspaceId) => {
    const targets = await resolveChannelTargets(workspaceId);
    const connectionIds = targets
      .map((target) => target.connectionId)
      .filter((id): id is string => Boolean(id));
    if (connectionIds.length === 0) return [];
    const { data, error } = await getServiceDb()
      .from('platform_connections')
      .select('id, workspace_id, platform, account_id, account_name, status')
      .eq('workspace_id', workspaceId)
      .in('id', connectionIds)
      .eq('status', 'active')
      .returns<
        Array<{
          id: string;
          workspace_id: string;
          platform: string;
          account_id: string | null;
          account_name: string;
          status: string;
        }>
      >();
    if (error) throw new Error(`Writer destination lookup failed: ${error.message}`);
    const connectionById = new Map((data ?? []).map((connection) => [connection.id, connection]));
    return targets.flatMap((target) => {
      if (!target.connectionId) return [];
      const connection = connectionById.get(target.connectionId);
      return connection
        ? [
            {
              channelKey: target.channelKey,
              connectionId: connection.id,
              platform: connection.platform,
              accountId: connection.account_id,
              accountName: connection.account_name,
              characterLimit: target.characterLimit,
              format: target.format,
            },
          ]
        : [];
    });
  },
  loadDna: async (workspaceId, profileId) => {
    const result = await getContentDna(workspaceId);
    const dna = result.dnaProfile;
    if (!dna || (profileId && dna.id !== profileId)) {
      throw new ApiError(
        409,
        'Writer needs the selected active Content DNA profile.',
        'writer_dna_required'
      );
    }
    return {
      profileId: dna.id,
      version: dna.version,
      promptVersion: dna.prompt_version,
    };
  },
  loadProofs: async (workspaceId, ids) =>
    (await listGateUsableProofAssets(workspaceId, { ids })).map((proof) => ({
      id: proof.id,
      type: proof.type,
      content: proof.content,
      consentStatus: proof.consentStatus,
      verifiedAt: proof.verifiedAt,
    })),
  createItem: async ({ workspaceId, signal, mixBucket }) =>
    createContentItem(workspaceId, {
      signalRef: signal.id,
      signalKind: signal.kind,
      title: signal.title,
      strength: signal.strength,
      evidence: {
        ...signal.evidence,
        communityIds: signal.evidence.communityIds,
      },
      mixBucket,
      staleAfter: signal.staleAfter,
      reason: 'Writer selected this signal for one bounded recommendation.',
      actor: 'system',
    }),
  transitionItem: async (itemId, state, detail) => {
    await transitionContentItem(
      detail.workspaceId,
      itemId,
      {
        to: state,
        reason: detail.reason,
        actor: 'system',
        metadata: detail.metadata,
      },
      detail.patch
    );
  },
  generateConcept: async ({ workspaceId, signal, targets, mixBucket, dna }) => {
    const response = await generateConcepts(workspaceId, {
      content_goal: GOAL_BY_BUCKET[mixBucket],
      angle: signal.title,
      user_idea: signal.title,
      settings: DEFAULT_CONCEPT_SETTINGS,
      target_platforms: [
        ...new Set(targets.map((target) => target.platform as PlatformType)),
      ],
    });
    const preferredLens = conceptLensForBucket(mixBucket);
    const concept =
      response.concepts.find((candidate) => candidate.lens === preferredLens) ??
      response.concepts[0];
    if (!concept) {
      throw new ApiError(409, 'Writer generated no usable concept.', 'writer_no_concept');
    }
    return {
      title: concept.title,
      angle: concept.angle,
      canonicalContent: concept.canonical_content,
      structureLabel: concept.structure_label,
      promptVersion: dna.promptVersion,
    };
  },
  generateVariants: async ({
    workspaceId,
    contentItemId,
    concept,
    targets,
    proofs,
    repairAttempt,
    remedies,
  }) => {
    const result = await generateChannelNativeVariants(workspaceId, {
      concept,
      targets: targets.map((target) => ({
        channelKey: target.channelKey,
        connectionId: target.connectionId,
        platform: target.platform as PlatformType,
        accountLabel: target.accountName,
        characterLimit: target.characterLimit,
        format: target.format,
      })),
      proofAssets: proofs.map((proof) => ({
        id: proof.id,
        type: proof.type,
        content: proof.content,
      })),
      evidenceSummary:
        repairAttempt === 0
          ? null
          : `Repair attempt ${repairAttempt}. Apply only these remedies: ${remedies.join(', ')}.`,
    });
    return Promise.all(
      result.variants.map(async (variant) => {
        const row = await upsertVariant(workspaceId, {
          contentItemId,
          channelKey: variant.channelKey,
          platform: variant.platform,
          connectionId: variant.connectionId,
          format: variant.format,
          content: variant.content,
          segments: variant.segments,
          structure: variant.structure,
          proofAssetIds: variant.proofAssetIds,
        });
        return {
          id: row.id,
          channelKey: row.channel_key,
          connectionId: row.connection_id as string,
          platform: row.platform,
          format: row.format,
          content: row.content,
          segments: row.segments,
          structure: row.structure,
          proofAssetIds: row.proof_asset_ids,
        };
      })
    );
  },
  evaluateVariant: (variant, proofs) =>
    runQualityGate({
      content: variant.content,
      platform: variant.platform as PlatformType,
      structure: variant.structure,
      proofAssets: proofs,
    }),
  persistGateAttempt: async (workspaceId, variantId, repairAttempt, attempt) => {
    await saveVariantGateResult(
      workspaceId,
      variantId,
      {
        ...writerGateResultJson(attempt.gate, repairAttempt),
      },
      attempt.gate.passed
    );
  },
  proposeSlot: async (workspaceId, connectionIds, now) => {
    const slot = await nextFreePostingSlot({ workspaceId, connectionIds, now });
    return slot ? { instant: slot.instant, timezone: slot.timezone } : null;
  },
  createReview: ({ workspaceId, snapshot, expiresAt }) =>
    createWriterReview(workspaceId, snapshot, expiresAt),
};

export async function runWriter(
  input: { workspaceId: string; mode: WriterRunMode },
  now: Date = new Date()
): Promise<WriterRunResult> {
  return executeWriterRun(input, defaultDependencies, now);
}
