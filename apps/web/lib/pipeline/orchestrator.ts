// Plan 2 / 2B.1 + 2B.4 — Orchestrator und Frequenz-Motor.
//
// Ausdrückliche NICHT-Aufgabe (§6.1): die vorhandenen Services werden nicht
// umgeschrieben. angle-service, concept-service, slot-allocator und
// posting-schedules werden hier ORCHESTRIERT; wo eine Signatur nicht passt,
// steht ein dünner Adapter in DIESER Datei davor.
//
// Frequenz-Motor: der Scheduler wählt nach Content-Mix, nicht nach
// Reihenfolge. Sonst kippt jedes hochfrequente Konto in Monotonie — und
// Monotonie ist derselbe Glaubwürdigkeitsverlust wie eine erfundene Zahl,
// nur langsamer.
import type { ContentGoal, PlatformType } from '@prolora/shared';
import { DEFAULT_CONCEPT_SETTINGS } from '@prolora/shared';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { ApiError } from '@/lib/api/http';
import { suggestAngles } from '@/lib/content/angle-service';
import { generateConcepts } from '@/lib/content/concept-service';
import { listContentReferences } from '@/lib/content/references';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { listGateUsableProofAssets } from '@/lib/feedback/proof-extraction';
import { inngest } from '@/lib/inngest/client';
import { getCoverageDays, listSignals, type Signal, type SignalKind } from '@/lib/pipeline/inventory';
import { getChannelCapacity, type ChannelCapacity } from '@/lib/connections/capacity';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { nextFreePostingSlot } from '@/lib/posts/posting-schedules';
import {
  channelTargetFromConnection,
  estimateChannelNativeCredits,
  generateChannelNativeVariants,
  type ChannelTarget,
  type CreditEstimate,
} from '@/lib/pipeline/channel-native';
import {
  gateResultToJson,
  runQualityGate,
  summarizeGateResults,
  type GateProofAsset,
  type GateResult,
  type GateStats,
  type GateThresholdOverrides,
  type SelfSimilarityContext,
} from '@/lib/pipeline/quality-gate';
import {
  createContentItem,
  findStalledItems,
  getContentItem,
  isStale,
  listContentItems,
  listVariants,
  markStalled,
  saveVariantGateResult,
  transitionContentItem,
  upsertVariant,
  type ContentItemRow,
  type MixBucket,
  type TransitionActor,
} from '@/lib/pipeline/state';

// ---------------------------------------------------------------------------
// Kapazität — Vertrag aus Plan 1 (§4.3)
// ---------------------------------------------------------------------------

export interface PipelineChannelCapacity {
  remainingToday: number | null;
}

/**
 * I2: Der Stub aus §4.3 ist durch Plan 1s echtes `getChannelCapacity` ersetzt.
 *
 * Aggregation je Workspace: `getChannelCapacity` liefert eine Zeile pro Kanal,
 * der Frequenz-Motor braucht aber eine Obergrenze für den ganzen Tag. Regeln —
 *  - gesperrte Kanäle zählen nicht mit (rate_limited/token_expired/revoked),
 *  - ein einziger unbegrenzter Kanal (`remainingToday === null`, z. B. Bluesky
 *    oder Mastodon) macht die Summe unbegrenzt → null,
 *  - sonst die Summe der bekannten Restmengen.
 *
 * null heißt weiterhin "unbekannt/unbegrenzt", also NICHT begrenzen. Ein Fehler
 * beim Kapazitätsabruf darf die Fabrik nicht anhalten — er degradiert zu null,
 * denn der Scheduler bricht ohnehin ab, wenn ein Item keinen freien Slot oder
 * keine Verbindung hat.
 */
export async function getPipelineChannelCapacity(
  workspaceId: string
): Promise<PipelineChannelCapacity> {
  let channels: ChannelCapacity[];
  try {
    channels = await getChannelCapacity(workspaceId);
  } catch (error) {
    console.error('[pipeline:capacity] Abruf fehlgeschlagen, keine Begrenzung:', error);
    return { remainingToday: null };
  }

  const usable = channels.filter((channel) => !channel.blocked);
  if (usable.length === 0) return { remainingToday: null };
  if (usable.some((channel) => channel.remainingToday === null)) return { remainingToday: null };

  const total = usable.reduce((sum, channel) => sum + (channel.remainingToday ?? 0), 0);
  return { remainingToday: total };
}

// ---------------------------------------------------------------------------
// Content-Mix (2B.4)
// ---------------------------------------------------------------------------

export type ContentMix = Record<MixBucket, number>;

export const DEFAULT_CONTENT_MIX: ContentMix = {
  insight: 0.4,
  proof: 0.3,
  story: 0.2,
  question: 0.1,
};

export const MIX_BUCKETS: MixBucket[] = ['insight', 'proof', 'story', 'question'];

export function mixBucketForSignal(kind: SignalKind): MixBucket {
  switch (kind) {
    case 'unused_proof':
      return 'proof';
    case 'community_question':
      return 'question';
    case 'splinter':
      return 'story';
    case 'winner_followup':
    case 'feedback_theme':
    default:
      return 'insight';
  }
}

export function normalizeMix(mix: Partial<ContentMix> | undefined): ContentMix {
  const merged = { ...DEFAULT_CONTENT_MIX, ...mix };
  const total = MIX_BUCKETS.reduce((sum, bucket) => sum + Math.max(0, merged[bucket]), 0);
  if (total <= 0) return { ...DEFAULT_CONTENT_MIX };
  return MIX_BUCKETS.reduce((acc, bucket) => {
    acc[bucket] = Math.max(0, merged[bucket]) / total;
    return acc;
  }, {} as ContentMix);
}

export interface MixCandidate {
  id: string;
  mixBucket: MixBucket;
  strength: number;
}

export function emptyMixCounts(): Record<MixBucket, number> {
  return { insight: 0, proof: 0, story: 0, question: 0 };
}

/**
 * Wählt `take` Kandidaten so, dass die Verteilung sich dem Ziel-Mix annähert.
 * Rein und exportiert — ohne Test wäre "der Scheduler wählt nach Mix" eine
 * Behauptung statt einer Eigenschaft.
 */
export function selectByMix(input: {
  candidates: MixCandidate[];
  recentCounts?: Record<MixBucket, number>;
  mix?: Partial<ContentMix>;
  take: number;
}): MixCandidate[] {
  const mix = normalizeMix(input.mix);
  const counts = { ...emptyMixCounts(), ...(input.recentCounts ?? {}) };
  const pools = MIX_BUCKETS.reduce(
    (acc, bucket) => {
      acc[bucket] = input.candidates
        .filter((candidate) => candidate.mixBucket === bucket)
        .sort((a, b) => b.strength - a.strength);
      return acc;
    },
    {} as Record<MixBucket, MixCandidate[]>
  );

  const picked: MixCandidate[] = [];
  const take = Math.max(0, input.take);
  for (let index = 0; index < take; index++) {
    let total = MIX_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0);
    total += 1; // der Platz, der gerade vergeben wird
    let best: MixBucket | null = null;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (const bucket of MIX_BUCKETS) {
      if (pools[bucket].length === 0) continue;
      const deficit = mix[bucket] * total - counts[bucket];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = bucket;
      }
    }
    if (!best) break;
    const candidate = pools[best].shift();
    if (!candidate) break;
    counts[best] += 1;
    picked.push(candidate);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Kanäle
// ---------------------------------------------------------------------------

export async function resolveChannelTargets(workspaceId: string): Promise<ChannelTarget[]> {
  const connections = await getConnectionsWithCharacterLimits(workspaceId);
  return connections
    .filter((connection) => connection.status === 'active')
    .map((connection) =>
      channelTargetFromConnection({
        connectionId: connection.connection_id,
        platform: connection.platform as PlatformType,
        accountLabel: connection.account_name,
        characterLimit: connection.character_limit,
      })
    );
}

// ---------------------------------------------------------------------------
// Schritt 0: Signale -> Werkstücke
// ---------------------------------------------------------------------------

export interface IngestResult {
  created: string[];
  skipped: number;
}

export async function ingestSignals(
  workspaceId: string,
  opts: { minStrength?: number; limit?: number; kinds?: SignalKind[] } = {}
): Promise<IngestResult> {
  const signals = await listSignals(workspaceId, {
    minStrength: opts.minStrength,
    kinds: opts.kinds,
    limit: opts.limit ?? 25,
  });
  const created: string[] = [];
  let skipped = 0;

  for (const signal of signals) {
    try {
      const item = await createContentItem(workspaceId, {
        signalRef: signal.id,
        signalKind: signal.kind,
        title: signal.title,
        strength: signal.strength,
        evidence: signal.evidence,
        mixBucket: mixBucketForSignal(signal.kind),
        staleAfter: signal.staleAfter,
        reason: `Signal übernommen (${signal.kind}, Stärke ${signal.strength.toFixed(2)})`,
        actor: 'system',
      });
      created.push(item.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signal_already_used') {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Schritt 1: signal -> angled (deterministisch, 0 Credits)
// ---------------------------------------------------------------------------

const GOAL_BY_BUCKET: Record<MixBucket, ContentGoal> = {
  insight: 'authority',
  proof: 'productEducation',
  story: 'personalStory',
  question: 'community',
};

export async function advanceToAngled(
  workspaceId: string,
  item: ContentItemRow
): Promise<ContentItemRow> {
  const [context, proofAssets, references] = await Promise.all([
    getWorkspaceContext(workspaceId),
    listGateUsableProofAssets(workspaceId, { ids: item.evidence.proofAssetIds }),
    listContentReferences(workspaceId),
  ]);

  // Adapter: suggestAngles erwartet den ProofAsset-DTO des Produktprofils.
  const angles = suggestAngles({
    goal: GOAL_BY_BUCKET[item.mix_bucket],
    productDescription: context?.product_description ?? null,
    coreValue: context?.core_value ?? [],
    proofAssets: proofAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      content: asset.content,
      source_url: asset.sourceUrl,
      verified_at: asset.verifiedAt,
      created_at: asset.createdAt,
    })),
    references,
  });

  const preferredLens =
    item.mix_bucket === 'story' ? 'founder' : item.mix_bucket === 'question' ? 'community' : 'evidence';
  const angle = angles.find((entry) => entry.lens === preferredLens) ?? angles[0];
  if (!angle) {
    return transitionContentItem(workspaceId, item.id, {
      to: 'rejected',
      reason: 'Kein Blickwinkel ableitbar — Produktprofil und Belege fehlen.',
      actor: 'system',
    });
  }

  return transitionContentItem(
    workspaceId,
    item.id,
    {
      to: 'angled',
      reason: `Blickwinkel „${angle.title}" (${angle.lens}) gewählt`,
      actor: 'system',
      metadata: { lens: angle.lens, reference_id: angle.reference_id },
    },
    { angle: { ...angle } }
  );
}

// ---------------------------------------------------------------------------
// Schritt 2: angled -> concepted (vorhandener concept-service)
// ---------------------------------------------------------------------------

export async function advanceToConcepted(
  workspaceId: string,
  item: ContentItemRow,
  targets: ChannelTarget[]
): Promise<ContentItemRow> {
  const angle = (item.angle ?? {}) as { angle?: string; lens?: string; title?: string };
  const platforms = [...new Set(targets.map((target) => target.platform))];
  if (platforms.length === 0) {
    return transitionContentItem(workspaceId, item.id, {
      to: 'rejected',
      reason: 'Kein aktiver Kanal verbunden — es gibt nichts, wofür ein Konzept entstehen könnte.',
      actor: 'system',
    });
  }

  // Adapter: der vorhandene Service bleibt unverändert; hier wird nur seine
  // Eingabe aus dem Werkstück zusammengesetzt.
  const response = await generateConcepts(workspaceId, {
    content_goal: GOAL_BY_BUCKET[item.mix_bucket],
    angle: angle.angle ?? item.title,
    user_idea: item.title,
    settings: DEFAULT_CONCEPT_SETTINGS,
    target_platforms: platforms,
  });

  const preferredLens = angle.lens;
  const concept =
    response.concepts.find((entry) => entry.lens === preferredLens) ?? response.concepts[0];
  if (!concept) {
    return transitionContentItem(workspaceId, item.id, {
      to: 'rejected',
      reason: 'Konzepterzeugung lieferte keinen verwertbaren Entwurf.',
      actor: 'system',
    });
  }

  return transitionContentItem(
    workspaceId,
    item.id,
    {
      to: 'concepted',
      reason: `Konzept „${concept.title}" (${concept.lens}) übernommen`,
      actor: 'system',
      metadata: { credits_used: response.credits_used, risk_flag: concept.risk_flag },
    },
    { concept: { ...concept } }
  );
}

// ---------------------------------------------------------------------------
// Schritt 3: concepted -> drafted (kanal-native Varianten)
// ---------------------------------------------------------------------------

export async function advanceToDrafted(
  workspaceId: string,
  item: ContentItemRow,
  targets: ChannelTarget[]
): Promise<ContentItemRow> {
  const concept = (item.concept ?? {}) as {
    title?: string;
    angle?: string;
    canonical_content?: string;
    structure_label?: string;
  };
  if (!concept.canonical_content) {
    return transitionContentItem(workspaceId, item.id, {
      to: 'rejected',
      reason: 'Kein Konzepttext vorhanden — kanal-native Erzeugung nicht möglich.',
      actor: 'system',
    });
  }

  const proofAssets = await listGateUsableProofAssets(workspaceId, {
    ids: item.evidence.proofAssetIds,
  });

  const result = await generateChannelNativeVariants(workspaceId, {
    concept: {
      title: concept.title ?? item.title,
      angle: concept.angle ?? '',
      canonicalContent: concept.canonical_content,
      structureLabel: concept.structure_label ?? null,
    },
    targets,
    proofAssets: proofAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      content: asset.content,
    })),
    evidenceSummary: describeProvenance(item),
  });

  for (const variant of result.variants) {
    const embedding = await generateEmbedding(variant.content);
    await upsertVariant(workspaceId, {
      contentItemId: item.id,
      channelKey: variant.channelKey,
      platform: variant.platform,
      connectionId: variant.connectionId,
      format: variant.format,
      content: variant.content,
      segments: variant.segments,
      structure: variant.structure,
      proofAssetIds: variant.proofAssetIds.filter((id) =>
        proofAssets.some((asset) => asset.id === id)
      ),
      embedding,
    });
  }

  if (result.variants.length === 0) {
    return transitionContentItem(workspaceId, item.id, {
      to: 'rejected',
      reason: 'Kanal-native Erzeugung lieferte keine Variante.',
      actor: 'system',
    });
  }

  return transitionContentItem(workspaceId, item.id, {
    to: 'drafted',
    reason: `${result.variants.length} kanal-native Variante(n) in ${result.calls} Aufruf(en) erzeugt`,
    actor: 'system',
    metadata: {
      credits_used: result.creditsUsed,
      calls: result.calls,
      missing_channels: result.missingChannels,
    },
  });
}

/** „Aus 23 Feedbacks → Proof: Ticket-Rückgang 31 % → Prognose 78." */
export function describeProvenance(item: Pick<ContentItemRow, 'evidence' | 'signal_kind'>): string {
  const parts: string[] = [];
  if (item.evidence.feedbackItemIds.length > 0) {
    parts.push(`${item.evidence.feedbackItemIds.length} Feedback(s)`);
  }
  if (item.evidence.proofAssetIds.length > 0) {
    parts.push(`${item.evidence.proofAssetIds.length} Beleg(e)`);
  }
  if (item.evidence.communityIds.length > 0) {
    parts.push(`${item.evidence.communityIds.length} Community-Quelle(n)`);
  }
  if (item.evidence.referenceIds.length > 0) {
    parts.push(`${item.evidence.referenceIds.length} Muster`);
  }
  return parts.length > 0 ? `${item.signal_kind}: ${parts.join(' → ')}` : item.signal_kind;
}

// ---------------------------------------------------------------------------
// Schritt 4: drafted -> gated (das blockierende Gate)
// ---------------------------------------------------------------------------

async function buildSelfSimilarityContext(
  workspaceId: string,
  windowDays: number
): Promise<SelfSimilarityContext | undefined> {
  const db = getServiceDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await db.rpc('content_variant_history_size', {
    match_workspace_id: workspaceId,
    match_since: since,
  });
  if (error) {
    // Ohne die RPC gibt es keine Historie -> Prüfung 4 wird übersprungen und
    // sichtbar als übersprungen gemeldet, niemals als bestanden.
    if (!isMissingSchemaError(error.code)) {
      console.error('[pipeline] history size lookup failed:', error.message);
    }
    return undefined;
  }
  const historySize = typeof data === 'number' ? data : 0;

  return {
    historySize,
    embed: (text: string) => generateEmbedding(text),
    findSimilar: async (embedding: number[]) => {
      const { data: matches, error: matchError } = await db.rpc(
        'match_content_variant_embeddings',
        {
          query_embedding: embedding,
          match_workspace_id: workspaceId,
          match_since: since,
        }
      );
      if (matchError) {
        console.error('[pipeline] similarity lookup failed:', matchError.message);
        return [];
      }
      return ((matches ?? []) as Array<{ id: string; similarity: number }>).map((row) => ({
        id: row.id,
        similarity: row.similarity,
      }));
    },
  };
}

export interface GateRunResult {
  item: ContentItemRow;
  results: Array<{ variantId: string; channelKey: string; gate: GateResult }>;
  stats: GateStats;
}

export async function runGateForItem(
  workspaceId: string,
  itemId: string,
  opts: { locale?: 'de' | 'en' | 'es'; thresholds?: GateThresholdOverrides } = {}
): Promise<GateRunResult> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) throw new ApiError(404, 'Content item not found.', 'not_found');

  const variants = await listVariants(workspaceId, itemId);
  if (variants.length === 0) {
    throw new ApiError(409, 'This item has no channel variants yet.', 'no_variants');
  }

  const proofAssets = await listGateUsableProofAssets(workspaceId, {
    ids: item.evidence.proofAssetIds,
  });
  const gateProofs: GateProofAsset[] = proofAssets.map((asset) => ({
    id: asset.id,
    type: asset.type,
    content: asset.content,
    consentStatus: asset.consentStatus,
  }));

  const windowDays = 90;
  const similarity = await buildSelfSimilarityContext(workspaceId, windowDays);

  const results: GateRunResult['results'] = [];
  for (const variant of variants) {
    const gate = await runQualityGate({
      content: variant.content,
      platform: variant.platform as PlatformType,
      structure: variant.structure,
      proofAssets: gateProofs,
      selfSimilarity: similarity,
      locale: opts.locale ?? 'de',
      thresholds: opts.thresholds,
      overriddenBy: variant.overridden_by,
    });
    await saveVariantGateResult(workspaceId, variant.id, gateResultToJson(gate), gate.passed);
    results.push({ variantId: variant.id, channelKey: variant.channel_key, gate });
  }

  const stats = summarizeGateResults(results.map((entry) => entry.gate));
  const anyPassed = results.some((entry) => entry.gate.passed);

  // Das Gate verweigert hart (D1): ohne eine bestandene Variante bleibt das
  // Werkstück in `drafted` und trägt den Grund — es verschwindet nicht.
  const updated = anyPassed
    ? await transitionContentItem(
        workspaceId,
        item.id,
        {
          to: 'gated',
          reason: `Gate bestanden: ${stats.passed}/${stats.evaluated} Varianten`,
          actor: 'system',
          metadata: { blocked_by: stats.blockedBy, skipped: stats.skipped },
        },
        { gateResult: { stats, checkedAt: new Date().toISOString() } }
      )
    : await transitionContentItem(
        workspaceId,
        item.id,
        {
          to: 'drafted',
          reason: `Gate blockiert alle ${stats.evaluated} Varianten (${describeBlockers(stats)})`,
          actor: 'system',
          metadata: { blocked_by: stats.blockedBy },
        },
        { gateResult: { stats, checkedAt: new Date().toISOString() } }
      );

  return { item: updated, results, stats };
}

export function describeBlockers(stats: GateStats): string {
  return Object.entries(stats.blockedBy)
    .filter(([, count]) => count > 0)
    .map(([check, count]) => `${check}: ${count}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Schritt 5: gated -> scheduled (Frequenz-Motor)
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  scheduled: Array<{ itemId: string; instant: string; mixBucket: MixBucket }>;
  capacityLimited: boolean;
}

export async function scheduleGatedItems(
  workspaceId: string,
  opts: { take?: number; mix?: Partial<ContentMix>; now?: Date } = {}
): Promise<ScheduleResult> {
  const [gated, recent, capacity] = await Promise.all([
    listContentItems(workspaceId, { states: ['gated'], limit: 100 }),
    listContentItems(workspaceId, { states: ['scheduled', 'published', 'measured'], limit: 100 }),
    getPipelineChannelCapacity(workspaceId),
  ]);

  const recentCounts = emptyMixCounts();
  for (const row of recent) recentCounts[row.mix_bucket] += 1;

  const requested = opts.take ?? 3;
  const take =
    capacity.remainingToday === null ? requested : Math.min(requested, capacity.remainingToday);

  const fresh = gated.filter((row) => !isStale(row, opts.now ?? new Date()));
  const picks = selectByMix({
    candidates: fresh.map((row) => ({
      id: row.id,
      mixBucket: row.mix_bucket,
      strength: row.strength,
    })),
    recentCounts,
    mix: opts.mix,
    take,
  });

  const scheduled: ScheduleResult['scheduled'] = [];
  for (const pick of picks) {
    const item = gated.find((row) => row.id === pick.id);
    if (!item) continue;
    const variants = await listVariants(workspaceId, item.id);
    const connectionIds = [
      ...new Set(
        variants
          .filter((variant) => variant.gate_passed === true && variant.connection_id)
          .map((variant) => variant.connection_id as string)
      ),
    ];
    if (connectionIds.length === 0) continue;

    // slot-allocator ist DST-sicher und wird NICHT nachgebaut (§12).
    const slot = await nextFreePostingSlot({
      workspaceId,
      connectionIds,
      now: opts.now,
    });
    if (!slot) continue;

    await transitionContentItem(
      workspaceId,
      item.id,
      {
        to: 'scheduled',
        reason: `Slot ${slot.localDate} ${slot.localTime} (${slot.timezone}) nach Mix „${item.mix_bucket}"`,
        actor: 'system',
        metadata: { slot_id: slot.slotId, connection_ids: connectionIds },
      },
      { scheduledAt: slot.instant }
    );
    scheduled.push({ itemId: item.id, instant: slot.instant, mixBucket: item.mix_bucket });
  }

  return { scheduled, capacityLimited: capacity.remainingToday !== null && take < requested };
}

// ---------------------------------------------------------------------------
// Ganzer Lauf + Kostenschätzung VOR dem Lauf
// ---------------------------------------------------------------------------

export interface PipelineEstimate extends CreditEstimate {
  conceptCredits: number;
  totalCredits: number;
  items: number;
  channels: number;
}

export async function estimatePipelineRun(
  workspaceId: string,
  opts: { limit?: number } = {}
): Promise<PipelineEstimate> {
  const [signals, targets, pending] = await Promise.all([
    listSignals(workspaceId, { limit: opts.limit ?? 10 }),
    resolveChannelTargets(workspaceId),
    listContentItems(workspaceId, { states: ['signal', 'angled', 'concepted'], limit: 100 }),
  ]);
  const items = Math.min(opts.limit ?? 10, signals.length + pending.length);
  const native = estimateChannelNativeCredits({
    conceptCount: items,
    channelCount: targets.length,
  });
  // Der vorhandene concept-service kostet 1 Credit je Werkstück (CREDIT_COSTS.post_concepts).
  const conceptCredits = items;
  return {
    ...native,
    conceptCredits,
    totalCredits: native.credits + conceptCredits,
    items,
    channels: targets.length,
  };
}

export interface PipelineRunResult {
  ingested: IngestResult;
  advanced: Array<{ itemId: string; state: string }>;
  gated: number;
  blocked: number;
  errors: Array<{ itemId: string; message: string }>;
}

/**
 * Fährt die Zustandsmaschine einen Schritt weiter — bewusst schrittweise statt
 * rekursiv, damit ein Fehler in einem Werkstück nicht den ganzen Lauf frisst.
 */
export async function runPipeline(
  workspaceId: string,
  opts: { limit?: number; minStrength?: number; locale?: 'de' | 'en' | 'es' } = {}
): Promise<PipelineRunResult> {
  const ingested = await ingestSignals(workspaceId, {
    minStrength: opts.minStrength,
    limit: opts.limit ?? 10,
  });
  const targets = await resolveChannelTargets(workspaceId);
  const pending = await listContentItems(workspaceId, {
    states: ['signal', 'angled', 'concepted', 'drafted'],
    limit: opts.limit ?? 10,
  });

  const advanced: PipelineRunResult['advanced'] = [];
  const errors: PipelineRunResult['errors'] = [];
  let gated = 0;
  let blocked = 0;

  for (const item of pending) {
    try {
      if (isStale(item)) {
        await transitionContentItem(workspaceId, item.id, {
          to: 'rejected',
          reason: 'Signal ist kalt geworden (stale_after überschritten).',
          actor: 'system',
        });
        advanced.push({ itemId: item.id, state: 'rejected' });
        continue;
      }
      if (item.state === 'signal') {
        const next = await advanceToAngled(workspaceId, item);
        advanced.push({ itemId: item.id, state: next.state });
      } else if (item.state === 'angled') {
        const next = await advanceToConcepted(workspaceId, item, targets);
        advanced.push({ itemId: item.id, state: next.state });
      } else if (item.state === 'concepted') {
        const next = await advanceToDrafted(workspaceId, item, targets);
        advanced.push({ itemId: item.id, state: next.state });
      } else if (item.state === 'drafted') {
        const result = await runGateForItem(workspaceId, item.id, { locale: opts.locale });
        advanced.push({ itemId: item.id, state: result.item.state });
        if (result.item.state === 'gated') gated += 1;
        else blocked += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown pipeline error';
      console.error(`[pipeline] item ${item.id} failed:`, message);
      errors.push({ itemId: item.id, message });
    }
  }

  return { ingested, advanced, gated, blocked, errors };
}

// ---------------------------------------------------------------------------
// Failure Mode §8: kein Item bleibt in einem Zwischenzustand hängen
// ---------------------------------------------------------------------------

export interface SweepResult {
  marked: number;
  rejected: number;
}

/**
 * Markiert hängengebliebene Werkstücke und verwirft die, deren Signal
 * inzwischen kalt ist. Ein `stalled`-Item bleibt sichtbar — stilles Löschen
 * wäre genau der Zustand, den §2 verbietet.
 */
export async function sweepStalledItems(now: Date = new Date()): Promise<SweepResult> {
  const stalled = await findStalledItems(now);
  let marked = 0;
  let rejected = 0;

  for (const item of stalled) {
    try {
      if (isStale(item, now)) {
        await transitionContentItem(item.workspace_id, item.id, {
          to: 'rejected',
          reason: `Hängengeblieben in „${item.state}" und Signal ist kalt — automatisch verworfen.`,
          actor: 'system',
        });
        rejected += 1;
        continue;
      }
      await markStalled(item.workspace_id, item.id, now);
      marked += 1;
    } catch (error) {
      console.error('[pipeline:sweep] item failed:', error);
    }
  }
  return { marked, rejected };
}

/**
 * Aufräum-Job nach dem Muster in lib/inngest/functions/ (cron-getriggert, damit
 * kein neuer Eventname in lib/inngest/client.ts nötig ist).
 *
 * In I2 registriert in `lib/inngest/functions/index.ts` und
 * `app/api/inngest/route.ts`. `POST /api/v1/pipeline/sweep` bleibt als
 * manueller Auslöser bestehen.
 */
export const pipelineStallSweep = inngest.createFunction(
  { id: 'pipeline-stall-sweep', retries: 1 },
  { cron: '*/30 * * * *' },
  async ({ step }) => step.run('sweep-stalled-items', () => sweepStalledItems())
);

// ---------------------------------------------------------------------------
// Cockpit
// ---------------------------------------------------------------------------

export interface CockpitCounts {
  scheduledToday: number;
  inGate: number;
  needsProof: number;
  blocked: number;
  stalled: number;
  coverageDays: number | null;
}

export function countsForToday(
  items: ContentItemRow[],
  now: Date = new Date()
): Omit<CockpitCounts, 'coverageDays'> {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  let scheduledToday = 0;
  let inGate = 0;
  let needsProof = 0;
  let blocked = 0;
  let stalled = 0;

  for (const item of items) {
    if (item.stalled_at) stalled += 1;
    if (item.state === 'scheduled' && item.scheduled_at) {
      const at = new Date(item.scheduled_at).getTime();
      if (at >= dayStart.getTime() && at < dayEnd.getTime()) scheduledToday += 1;
    }
    if (item.state === 'drafted' || item.state === 'gated') {
      inGate += 1;
      const stats = (item.gate_result as { stats?: GateStats } | null)?.stats;
      if (stats && stats.blocked > 0) {
        blocked += 1;
        if (stats.blockedBy.proof_binding > 0) needsProof += 1;
      }
    }
  }
  return { scheduledToday, inGate, needsProof, blocked, stalled };
}

export interface CockpitData {
  counts: CockpitCounts;
  items: ContentItemRow[];
  /** Gate-Statistik über die aktuell offenen Werkstücke (§8). */
  gate: GateStats;
}

/**
 * Tages-Cockpit statt Kalenderraster: „Heute: 3 geplant, 2 im Gate, 1 braucht
 * Proof". Ein Kalenderraster beantwortet "wann", das Cockpit beantwortet "was
 * hält gerade auf" — bei 2–3 Posts/Tag ist nur die zweite Frage interessant.
 */
export async function loadCockpit(workspaceId: string, now: Date = new Date()): Promise<CockpitData> {
  const [items, coverageDays] = await Promise.all([
    listContentItems(workspaceId, { limit: 200 }),
    getCoverageDays(workspaceId).catch((error: unknown) => {
      console.error('[pipeline] coverage lookup failed:', error);
      return null;
    }),
  ]);

  const gate: GateStats = {
    evaluated: 0,
    passed: 0,
    blocked: 0,
    overridden: 0,
    blockedBy: { proof_binding: 0, structure: 0, deterministic: 0, self_similarity: 0 },
    skipped: { proof_binding: 0, structure: 0, deterministic: 0, self_similarity: 0 },
  };
  for (const item of items) {
    const stats = (item.gate_result as { stats?: GateStats } | null)?.stats;
    if (!stats) continue;
    gate.evaluated += stats.evaluated;
    gate.passed += stats.passed;
    gate.blocked += stats.blocked;
    gate.overridden += stats.overridden;
    for (const check of Object.keys(gate.blockedBy) as Array<keyof GateStats['blockedBy']>) {
      gate.blockedBy[check] += stats.blockedBy?.[check] ?? 0;
      gate.skipped[check] += stats.skipped?.[check] ?? 0;
    }
  }

  return {
    counts: { ...countsForToday(items, now), coverageDays },
    items,
    gate,
  };
}

export interface TransitionRequest {
  to: ContentItemRow['state'];
  reason: string;
  actor: TransitionActor;
  actorId?: string | null;
}

export async function applyManualTransition(
  workspaceId: string,
  itemId: string,
  request: TransitionRequest
): Promise<ContentItemRow> {
  return transitionContentItem(workspaceId, itemId, {
    to: request.to,
    reason: request.reason,
    actor: request.actor,
    actorId: request.actorId ?? null,
    metadata: { manual: true },
  });
}

export type { Signal };
