// Plan 2 / 2B.1 — Zustandsmaschine der Content-Fabrik (Migration 017).
//
// ABWEICHUNG VON DER CLAUDE.md-KONVENTION (bewusst, mit dem Nutzer geklärt):
// Row-Types liegen sonst zentral in lib/db.ts. `ContentItemRow`,
// `ContentItemVariantRow` und `ContentItemTransitionRow` werden hier LOKAL
// definiert und von hier exportiert, weil Plan 2 zwei Agenten parallel im
// selben Arbeitsbaum laufen lässt und lib/db.ts sonst von beiden gleichzeitig
// geändert würde. Beim Zusammenführen dürfen sie nach lib/db.ts wandern.
//
// Zwei Invarianten, die dieser Layer durchsetzt:
//   1. Jeder Übergang schreibt `reason` und `actor`. Ein `rejected` ohne Grund
//      ist ein Bug, kein Zustand (§2) — Code UND CHECK-Constraint.
//   2. Invariante 2: getServiceDb() umgeht RLS, also filtert jede Query hier
//      explizit auf workspace_id.
import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

// --- Zustände -------------------------------------------------------------

export const CONTENT_ITEM_STATES = [
  'signal',
  'angled',
  'concepted',
  'drafted',
  'gated',
  'scheduled',
  'published',
  'measured',
  'rejected',
] as const;

export type ContentItemState = (typeof CONTENT_ITEM_STATES)[number];

export type TransitionActor = 'system' | 'user';

export type SignalKindValue =
  | 'feedback_theme'
  | 'unused_proof'
  | 'community_question'
  | 'splinter'
  | 'winner_followup';

export type MixBucket = 'insight' | 'proof' | 'story' | 'question';

export interface ContentItemEvidence {
  proofAssetIds: string[];
  feedbackItemIds: string[];
  communityIds: string[];
  referenceIds: string[];
}

export const EMPTY_EVIDENCE: ContentItemEvidence = {
  proofAssetIds: [],
  feedbackItemIds: [],
  communityIds: [],
  referenceIds: [],
};

export interface ContentItemRow {
  id: string;
  workspace_id: string;
  state: ContentItemState;
  signal_ref: string | null;
  signal_kind: SignalKindValue;
  title: string;
  strength: number;
  evidence: ContentItemEvidence;
  mix_bucket: MixBucket;
  angle: Record<string, unknown> | null;
  concept: Record<string, unknown> | null;
  gate_result: Record<string, unknown> | null;
  rejected_reason: string | null;
  stale_after: string | null;
  state_entered_at: string;
  stalled_at: string | null;
  post_group_id: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentItemVariantRow {
  id: string;
  content_item_id: string;
  workspace_id: string;
  channel_key: string;
  platform: string;
  connection_id: string | null;
  format: 'post' | 'thread' | 'article';
  content: string;
  segments: string[];
  structure: Record<string, string> | null;
  proof_asset_ids: string[];
  gate_result: Record<string, unknown> | null;
  gate_passed: boolean | null;
  overridden_by: string | null;
  overridden_at: string | null;
  override_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentItemTransitionRow {
  id: string;
  content_item_id: string;
  workspace_id: string;
  from_state: ContentItemState | null;
  to_state: ContentItemState;
  reason: string;
  actor: TransitionActor;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// `embedding` ist bewusst NICHT in der Allowlist — pgvector-Spalten gehören
// nie in eine Antwort (CLAUDE.md: kein select('*') auf Tabellen mit Embeddings).
export const CONTENT_ITEM_COLUMNS =
  'id, workspace_id, state, signal_ref, signal_kind, title, strength, evidence, ' +
  'mix_bucket, angle, concept, gate_result, rejected_reason, stale_after, ' +
  'state_entered_at, stalled_at, post_group_id, scheduled_at, created_at, updated_at';

export const CONTENT_ITEM_VARIANT_COLUMNS =
  'id, content_item_id, workspace_id, channel_key, platform, connection_id, format, ' +
  'content, segments, structure, proof_asset_ids, gate_result, gate_passed, ' +
  'overridden_by, overridden_at, override_reason, created_at, updated_at';

export const CONTENT_ITEM_TRANSITION_COLUMNS =
  'id, content_item_id, workspace_id, from_state, to_state, reason, actor, actor_id, ' +
  'metadata, created_at';

// --- Übergangsregeln ------------------------------------------------------

/**
 * signal → angled → concepted → drafted → gated → scheduled → published → measured
 * plus `rejected` aus jedem NICHT-terminalen Zustand (§2).
 */
export const ALLOWED_TRANSITIONS: Record<ContentItemState, ContentItemState[]> = {
  signal: ['angled', 'rejected'],
  angled: ['concepted', 'rejected'],
  concepted: ['drafted', 'rejected'],
  // Ein durchgefallenes Gate wirft das Werkstück auf `drafted` zurück, damit
  // die Reparatur (remedy) greifen kann — es verschwindet nicht stillschweigend.
  drafted: ['gated', 'drafted', 'rejected'],
  gated: ['scheduled', 'drafted', 'rejected'],
  scheduled: ['published', 'drafted', 'rejected'],
  published: ['measured'],
  measured: [],
  rejected: [],
};

export const TERMINAL_STATES: ContentItemState[] = ['measured', 'rejected'];

export function isContentItemState(value: unknown): value is ContentItemState {
  return typeof value === 'string' && (CONTENT_ITEM_STATES as readonly string[]).includes(value);
}

export function canTransition(from: ContentItemState, to: ContentItemState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface TransitionIntent {
  to: ContentItemState;
  reason: string;
  actor: TransitionActor;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Erzwingt beide Regeln im Code — noch bevor die DB sie sieht. Reine Funktion,
 * damit der Negativfall ohne Datenbank testbar ist.
 */
export function assertTransition(from: ContentItemState, intent: TransitionIntent): void {
  if (!isContentItemState(intent.to)) {
    throw new ApiError(400, `Unknown target state "${String(intent.to)}".`, 'invalid_transition');
  }
  if (intent.actor !== 'system' && intent.actor !== 'user') {
    throw new ApiError(400, 'A transition needs an actor ("system" or "user").', 'invalid_transition');
  }
  if (!intent.reason || intent.reason.trim().length === 0) {
    // Der wichtigste Satz dieser Datei: ohne Grund kein Übergang.
    throw new ApiError(
      400,
      'Every state transition needs a reason — a state change without a reason is a bug, not a state.',
      'transition_reason_required'
    );
  }
  if (intent.reason.trim().length > 1000) {
    throw new ApiError(400, 'Transition reason must be at most 1000 characters.', 'invalid_transition');
  }
  if (!canTransition(from, intent.to)) {
    throw new ApiError(
      409,
      `Transition ${from} → ${intent.to} is not allowed.`,
      'invalid_transition'
    );
  }
}

// --- Hängenbleiben (Failure Mode §8) --------------------------------------

/**
 * Wie lange ein Item in einem Zwischenzustand stehen darf, bevor der Sweep es
 * als `stalled` markiert. Terminal- und Wartezustände (`scheduled` wartet auf
 * seinen Slot, `published` auf Metriken) haben bewusst kein Timeout.
 */
export const STATE_TIMEOUT_MINUTES: Partial<Record<ContentItemState, number>> = {
  signal: 60,
  angled: 60,
  concepted: 120,
  drafted: 180,
  gated: 60 * 24 * 3,
};

export function isStalled(
  row: Pick<ContentItemRow, 'state' | 'state_entered_at'>,
  now: Date = new Date()
): boolean {
  const timeout = STATE_TIMEOUT_MINUTES[row.state];
  if (timeout === undefined) return false;
  const entered = new Date(row.state_entered_at).getTime();
  if (!Number.isFinite(entered)) return false;
  return now.getTime() - entered > timeout * 60_000;
}

export function isStale(
  row: Pick<ContentItemRow, 'stale_after'>,
  now: Date = new Date()
): boolean {
  if (!row.stale_after) return false;
  const deadline = new Date(row.stale_after).getTime();
  return Number.isFinite(deadline) && deadline < now.getTime();
}

// --- Persistenz -----------------------------------------------------------

const MIGRATION_PENDING = new ApiError(
  503,
  'The content pipeline storage is not set up yet — apply supabase/migrations/017_content_items.sql.',
  'migration_pending'
);

/** Damit Aufrufer den 503 wiederverwenden können, ohne ihn nachzubauen. */
export function pipelineMigrationPending(): ApiError {
  return MIGRATION_PENDING;
}

function normalizeEvidence(value: unknown): ContentItemEvidence {
  const raw = (value ?? {}) as Partial<Record<keyof ContentItemEvidence, unknown>>;
  const list = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    proofAssetIds: list(raw.proofAssetIds),
    feedbackItemIds: list(raw.feedbackItemIds),
    communityIds: list(raw.communityIds),
    referenceIds: list(raw.referenceIds),
  };
}

function hydrateItem(row: ContentItemRow): ContentItemRow {
  return { ...row, evidence: normalizeEvidence(row.evidence) };
}

export interface CreateContentItemInput {
  signalRef: string | null;
  signalKind: SignalKindValue;
  title: string;
  strength: number;
  evidence: ContentItemEvidence;
  mixBucket: MixBucket;
  staleAfter: string | null;
  /** Grund für den Eintritt in `signal` — auch der erste Schritt wird protokolliert. */
  reason: string;
  actor: TransitionActor;
  actorId?: string | null;
}

export async function createContentItem(
  workspaceId: string,
  input: CreateContentItemInput
): Promise<ContentItemRow> {
  if (!input.reason?.trim()) {
    throw new ApiError(
      400,
      'Creating a content item needs a reason — provenance is not optional.',
      'transition_reason_required'
    );
  }
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_items')
    .insert({
      workspace_id: workspaceId,
      state: 'signal',
      signal_ref: input.signalRef,
      signal_kind: input.signalKind,
      title: input.title.slice(0, 300),
      strength: Math.min(1, Math.max(0, input.strength)),
      evidence: input.evidence,
      mix_bucket: input.mixBucket,
      stale_after: input.staleAfter,
      state_entered_at: new Date().toISOString(),
    })
    .select(CONTENT_ITEM_COLUMNS)
    .single<ContentItemRow>();

  if (error || !data) {
    if (isMissingSchemaError(error?.code)) throw MIGRATION_PENDING;
    // 23505 = das Signal wurde bereits zu einem Werkstück (Idempotenz).
    if (error?.code === '23505') {
      throw new ApiError(409, 'This signal already has a content item.', 'signal_already_used');
    }
    throw new Error(`[pipeline] content item insert failed: ${error?.message ?? 'no row'}`);
  }

  await writeTransition(workspaceId, data.id, {
    from: null,
    to: 'signal',
    reason: input.reason,
    actor: input.actor,
    actorId: input.actorId ?? null,
    metadata: { signal_kind: input.signalKind, strength: input.strength },
  });

  return hydrateItem(data);
}

export async function getContentItem(
  workspaceId: string,
  itemId: string
): Promise<ContentItemRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_items')
    .select(CONTENT_ITEM_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', itemId)
    .maybeSingle<ContentItemRow>();
  if (error) {
    if (isMissingSchemaError(error.code)) return null;
    throw new Error(`[pipeline] content item read failed: ${error.message}`);
  }
  return data ? hydrateItem(data) : null;
}

export async function listContentItems(
  workspaceId: string,
  opts: { states?: ContentItemState[]; limit?: number } = {}
): Promise<ContentItemRow[]> {
  const db = getServiceDb();
  let query = db
    .from('content_items')
    .select(CONTENT_ITEM_COLUMNS)
    .eq('workspace_id', workspaceId);
  if (opts.states && opts.states.length > 0) {
    query = query.in('state', opts.states);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, opts.limit ?? 100)))
    .returns<ContentItemRow[]>();
  if (error) {
    // Lesepfad degradiert: ohne Tabelle bleibt das Cockpit leer statt zu crashen.
    if (isMissingSchemaError(error.code)) {
      console.error('[pipeline] content_items missing — apply migration 017:', error.message);
      return [];
    }
    throw new Error(`[pipeline] content item list failed: ${error.message}`);
  }
  return (data ?? []).map(hydrateItem);
}

export interface TransitionPatch {
  angle?: Record<string, unknown> | null;
  concept?: Record<string, unknown> | null;
  gateResult?: Record<string, unknown> | null;
  mixBucket?: MixBucket;
  postGroupId?: string | null;
  scheduledAt?: string | null;
}

/**
 * Der einzige erlaubte Weg, `content_items.state` zu ändern. Schreibt IMMER
 * eine Protokollzeile — der Übergang und sein Protokoll sind dasselbe Ereignis.
 */
export async function transitionContentItem(
  workspaceId: string,
  itemId: string,
  intent: TransitionIntent,
  patch: TransitionPatch = {}
): Promise<ContentItemRow> {
  const current = await getContentItem(workspaceId, itemId);
  if (!current) {
    throw new ApiError(404, 'Content item not found.', 'not_found');
  }
  assertTransition(current.state, intent);

  const update: Record<string, unknown> = {
    state: intent.to,
    state_entered_at: new Date().toISOString(),
    stalled_at: null,
  };
  if (intent.to === 'rejected') update.rejected_reason = intent.reason.trim();
  if (patch.angle !== undefined) update.angle = patch.angle;
  if (patch.concept !== undefined) update.concept = patch.concept;
  if (patch.gateResult !== undefined) update.gate_result = patch.gateResult;
  if (patch.mixBucket !== undefined) update.mix_bucket = patch.mixBucket;
  if (patch.postGroupId !== undefined) update.post_group_id = patch.postGroupId;
  if (patch.scheduledAt !== undefined) update.scheduled_at = patch.scheduledAt;

  const db = getServiceDb();
  const { data, error } = await db
    .from('content_items')
    .update(update)
    .eq('workspace_id', workspaceId)
    .eq('id', itemId)
    // Optimistisches Sperren: zwei parallele Läufe dürfen denselben Übergang
    // nicht doppelt fahren.
    .eq('state', current.state)
    .select(CONTENT_ITEM_COLUMNS)
    .maybeSingle<ContentItemRow>();

  if (error) {
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[pipeline] transition failed: ${error.message}`);
  }
  if (!data) {
    throw new ApiError(409, 'The item changed state concurrently — retry.', 'transition_conflict');
  }

  await writeTransition(workspaceId, itemId, {
    from: current.state,
    to: intent.to,
    reason: intent.reason,
    actor: intent.actor,
    actorId: intent.actorId ?? null,
    metadata: intent.metadata ?? {},
  });

  return hydrateItem(data);
}

async function writeTransition(
  workspaceId: string,
  itemId: string,
  entry: {
    from: ContentItemState | null;
    to: ContentItemState;
    reason: string;
    actor: TransitionActor;
    actorId: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const db = getServiceDb();
  const { error } = await db.from('content_item_transitions').insert({
    content_item_id: itemId,
    workspace_id: workspaceId,
    from_state: entry.from,
    to_state: entry.to,
    reason: entry.reason.trim().slice(0, 1000),
    actor: entry.actor,
    actor_id: entry.actorId,
    metadata: entry.metadata,
  });
  if (error) {
    // Das Protokoll ist Pflichtteil, kein Nice-to-have: fehlt es, ist der
    // Übergang nicht nachvollziehbar und der Aufruf gilt als gescheitert.
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[pipeline] transition log failed: ${error.message}`);
  }
}

export async function listTransitions(
  workspaceId: string,
  itemId: string,
  limit = 50
): Promise<ContentItemTransitionRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_item_transitions')
    .select(CONTENT_ITEM_TRANSITION_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('content_item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<ContentItemTransitionRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[pipeline] transition list failed: ${error.message}`);
  }
  return data ?? [];
}

// --- Varianten ------------------------------------------------------------

export interface UpsertVariantInput {
  contentItemId: string;
  channelKey: string;
  platform: string;
  connectionId: string | null;
  format: ContentItemVariantRow['format'];
  content: string;
  segments: string[];
  structure: Record<string, string> | null;
  proofAssetIds: string[];
  embedding?: number[] | null;
}

export async function upsertVariant(
  workspaceId: string,
  input: UpsertVariantInput
): Promise<ContentItemVariantRow> {
  const db = getServiceDb();
  const payload: Record<string, unknown> = {
    content_item_id: input.contentItemId,
    workspace_id: workspaceId,
    channel_key: input.channelKey,
    platform: input.platform,
    connection_id: input.connectionId,
    format: input.format,
    content: input.content,
    segments: input.segments,
    structure: input.structure,
    proof_asset_ids: input.proofAssetIds,
  };
  if (input.embedding && input.embedding.length > 0) {
    payload.embedding = input.embedding;
  }
  const { data, error } = await db
    .from('content_item_variants')
    .upsert(payload, { onConflict: 'content_item_id,channel_key' })
    .select(CONTENT_ITEM_VARIANT_COLUMNS)
    .single<ContentItemVariantRow>();
  if (error || !data) {
    if (isMissingSchemaError(error?.code)) throw MIGRATION_PENDING;
    throw new Error(`[pipeline] variant upsert failed: ${error?.message ?? 'no row'}`);
  }
  return data;
}

export async function listVariants(
  workspaceId: string,
  itemId: string
): Promise<ContentItemVariantRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_item_variants')
    .select(CONTENT_ITEM_VARIANT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('content_item_id', itemId)
    .order('created_at', { ascending: true })
    .returns<ContentItemVariantRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[pipeline] variant list failed: ${error.message}`);
  }
  return data ?? [];
}

export async function saveVariantGateResult(
  workspaceId: string,
  variantId: string,
  gateResult: Record<string, unknown>,
  passed: boolean
): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('content_item_variants')
    .update({ gate_result: gateResult, gate_passed: passed })
    .eq('workspace_id', workspaceId)
    .eq('id', variantId);
  if (error) {
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[pipeline] gate result save failed: ${error.message}`);
  }
}

/**
 * Entscheidung D1: Übersteuern ist erlaubt — aber nur mit Protokoll. Ohne
 * `overriddenBy` UND `reason` passiert hier gar nichts.
 */
export async function recordGateOverride(
  workspaceId: string,
  input: { variantId: string; contentItemId: string; overriddenBy: string; reason: string }
): Promise<string> {
  if (!input.overriddenBy?.trim()) {
    throw new ApiError(400, 'An override needs an identified person.', 'override_actor_required');
  }
  if (!input.reason?.trim()) {
    throw new ApiError(
      400,
      'An override needs a reason — an unlogged override turns the gate into a request.',
      'override_reason_required'
    );
  }
  const overriddenAt = new Date().toISOString();
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_item_variants')
    .update({
      overridden_by: input.overriddenBy.trim().slice(0, 200),
      overridden_at: overriddenAt,
      override_reason: input.reason.trim().slice(0, 1000),
      gate_passed: true,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', input.variantId)
    .eq('content_item_id', input.contentItemId)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[pipeline] override failed: ${error.message}`);
  }
  if (!data) {
    throw new ApiError(404, 'Variant not found.', 'not_found');
  }

  // Zweite Spur im unveränderlichen Protokoll — die Variantenzeile kann später
  // überschrieben werden, die Transition-Zeile nicht.
  await writeTransition(workspaceId, input.contentItemId, {
    from: null,
    to: 'gated',
    reason: `Gate übersteuert: ${input.reason.trim()}`,
    actor: 'user',
    actorId: input.overriddenBy.trim().slice(0, 200),
    metadata: { kind: 'gate_override', variant_id: input.variantId, overridden_at: overriddenAt },
  });

  return overriddenAt;
}

// --- Stall-Sweep ----------------------------------------------------------

export async function findStalledItems(
  now: Date = new Date(),
  limit = 200
): Promise<ContentItemRow[]> {
  const db = getServiceDb();
  // Ältestes mögliches Timeout als grober Vorfilter; die genaue Entscheidung
  // trifft isStalled() pro Zustand.
  const minTimeout = Math.min(...Object.values(STATE_TIMEOUT_MINUTES));
  const cutoff = new Date(now.getTime() - minTimeout * 60_000).toISOString();
  const { data, error } = await db
    .from('content_items')
    .select(CONTENT_ITEM_COLUMNS)
    .in('state', ['signal', 'angled', 'concepted', 'drafted', 'gated'])
    .is('stalled_at', null)
    .lt('state_entered_at', cutoff)
    .order('state_entered_at', { ascending: true })
    .limit(limit)
    .returns<ContentItemRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[pipeline] stall scan failed: ${error.message}`);
  }
  return (data ?? []).map(hydrateItem).filter((row) => isStalled(row, now));
}

export async function markStalled(
  workspaceId: string,
  itemId: string,
  now: Date = new Date()
): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('content_items')
    .update({ stalled_at: now.toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', itemId);
  if (error && !isMissingSchemaError(error.code)) {
    throw new Error(`[pipeline] stall mark failed: ${error.message}`);
  }
}
