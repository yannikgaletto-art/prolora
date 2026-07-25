// Persistente Feedback-Themen (Plan 2 / 2A.1 + 2A.2, Migration 016).
//
// Die pgvector-Embeddings in feedback_items werden heute nur für Dedupe genutzt.
// Dieselben Vektoren clustern hier zu Themen mit Verlauf über Wochen.
//
// Die eine Entscheidung, die alles trägt: CLUSTER-IDENTITÄT IST STABIL. Ein Lauf
// clustert nicht neu, er ORDNET ZU — gegen die persistierten Zentroiden bestehender
// Themen. Ein neues Thema entsteht nur, wenn kein bestehender Zentroid über
// THEME_MATCH_THRESHOLD liegt. Ohne diese Regel spränge jedes Thema zwischen
// Läufen um und "Momentum" (unten) wäre Rauschen statt Signal (Plan 2 §8).
//
// Momentum misst NEUHEIT/BESCHLEUNIGUNG, nicht Häufigkeit: ein Thema von 2 auf 14
// Nennungen ist das stärkste Signal. Das Verfahren ist bewusst dasselbe wie in
// lib/scoring/baseline.ts (median/MAD + classifyOutcome) — ein Baseline-Konzept im
// Projekt, nicht zwei.
//
// Row-Types stehen LOKAL statt in lib/db.ts: Plan 2 lässt zwei Agenten parallel
// arbeiten, und lib/db.ts gehört in diesem Lauf dem anderen Strang. Beim
// Zusammenführen können sie nach lib/db.ts wandern.
import {
  classifyOutcome,
  computeBaseline,
  type OutcomeBucket,
} from '@/lib/scoring/baseline';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

// ---------------------------------------------------------------------------
// Row-Types (Migration 016)
// ---------------------------------------------------------------------------

export interface FeedbackThemeRow {
  id: string;
  workspace_id: string;
  label: string;
  keywords: string[];
  /** pgvector kommt über PostgREST als '[0.1,0.2,...]'-String zurück. */
  centroid: string | number[] | null;
  member_count: number;
  recent_count: number;
  previous_count: number;
  momentum: number;
  momentum_ratio: number | null;
  momentum_bucket: OutcomeBucket | null;
  first_seen_at: string;
  last_seen_at: string;
  last_clustered_at: string | null;
  status: 'active' | 'archived';
  created_at: string;
}

export interface FeedbackThemeMemberRow {
  id: string;
  workspace_id: string;
  theme_id: string;
  feedback_item_id: string;
  similarity: number | null;
  occurred_at: string;
  assigned_at: string;
}

/** Öffentliche Sicht — ohne Zentroid (1536 Zahlen gehören nicht in eine API). */
export const THEME_PUBLIC_COLUMNS = [
  'id', 'workspace_id', 'label', 'keywords', 'member_count', 'recent_count',
  'previous_count', 'momentum', 'momentum_ratio', 'momentum_bucket',
  'first_seen_at', 'last_seen_at', 'last_clustered_at', 'status', 'created_at',
].join(', ');

export interface FeedbackTheme {
  id: string;
  workspaceId: string;
  label: string;
  keywords: string[];
  memberCount: number;
  recentCount: number;
  previousCount: number;
  /** 0..1 — speist Signal.strength in lib/pipeline/inventory.ts. */
  momentum: number;
  momentumRatio: number | null;
  momentumBucket: OutcomeBucket | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'active' | 'archived';
}

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/**
 * Kosinus-Schwelle für "gehört zum selben Thema". Bewusst deutlich unter der
 * Dedupe-Schwelle 0.92 aus match_feedback_embeddings (003_functions.sql): Dedupe
 * sucht dasselbe Feedback, Clustering sucht dasselbe *Thema*.
 */
export const THEME_MATCH_THRESHOLD = 0.82;
/** Ein einzelnes Feedback ist kein Thema. Erst ab zwei entsteht eins. */
export const MIN_NEW_THEME_MEMBERS = 2;
/** Zählfenster für Momentum. */
export const MOMENTUM_WINDOW_DAYS = 7;
/** Wie viele Fenster zurück die Baseline gebildet wird (7 Historie + 1 aktuell). */
export const MOMENTUM_WINDOWS = 9;
const MAX_ITEMS_PER_RUN = 500;
const MAX_KNOWN_MEMBERS = 5000;
const MAX_THEMES = 200;

// ---------------------------------------------------------------------------
// Reine Vektor-Helfer (unit-getestet)
// ---------------------------------------------------------------------------

/** pgvector über PostgREST: '[0.1,0.2]' -> [0.1, 0.2]. null bei Unbrauchbarem. */
export function parseVector(value: string | number[] | null | undefined): number[] | null {
  if (Array.isArray(value)) {
    return value.every((n) => typeof n === 'number' && Number.isFinite(n)) && value.length > 0
      ? value
      : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return null;
  const parsed = inner.split(',').map((part) => Number(part));
  return parsed.every((n) => Number.isFinite(n)) ? parsed : null;
}

/** pgvector-Literal für Schreibpfade. */
export function serializeVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Laufender Mittelwert — der Zentroid wandert mit, ohne alles neu zu laden. */
export function updateCentroid(
  centroid: number[],
  count: number,
  addition: number[]
): number[] {
  if (centroid.length !== addition.length || count <= 0) return addition.slice();
  const next = new Array<number>(centroid.length);
  for (let i = 0; i < centroid.length; i += 1) {
    next[i] = (centroid[i] * count + addition[i]) / (count + 1);
  }
  return next;
}

export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dims) continue;
    for (let i = 0; i < dims; i += 1) sum[i] += vector[i];
  }
  return sum.map((value) => value / vectors.length);
}

// ---------------------------------------------------------------------------
// Zuordnung (der stabile Kern — rein, damit Stabilität testbar ist)
// ---------------------------------------------------------------------------

export interface ClusterableItem {
  id: string;
  embedding: number[];
  occurredAt: string;
  topics: string[];
  category: string | null;
  summary: string | null;
}

export interface ExistingTheme {
  id: string;
  centroid: number[];
  memberCount: number;
}

export interface ClusterAssignment {
  itemId: string;
  /** Bestehende Theme-ID, oder der `key` eines Eintrags aus `newThemes`. */
  themeKey: string;
  similarity: number;
}

export interface PlannedTheme {
  key: string;
  centroid: number[];
  memberIds: string[];
}

export interface ClusterPlan {
  assignments: ClusterAssignment[];
  newThemes: PlannedTheme[];
  /** Items, die kein Thema erreicht haben — bleiben für den nächsten Lauf offen. */
  skipped: string[];
}

/**
 * Ordnet Items bestehenden Themen zu und bildet nur dort neue, wo nichts passt.
 *
 * Determinismus ist Teil des Vertrags: gleiche Eingabe -> gleiche Ausgabe.
 * Deshalb wird nach occurredAt (Tiebreak: id) sortiert, bevor gegriffen wird.
 */
export function planClustering(
  items: ClusterableItem[],
  existing: ExistingTheme[],
  options: { threshold?: number; minNewMembers?: number } = {}
): ClusterPlan {
  const threshold = options.threshold ?? THEME_MATCH_THRESHOLD;
  const minNewMembers = options.minNewMembers ?? MIN_NEW_THEME_MEMBERS;

  const working = existing
    .filter((theme) => theme.centroid.length > 0)
    .map((theme) => ({
      key: theme.id,
      centroid: theme.centroid.slice(),
      count: Math.max(1, theme.memberCount),
      isNew: false,
      memberIds: [] as string[],
    }));

  const ordered = [...items].sort((left, right) => {
    const byTime = left.occurredAt.localeCompare(right.occurredAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });

  const assignments: ClusterAssignment[] = [];
  for (const item of ordered) {
    if (item.embedding.length === 0) continue;

    let best: (typeof working)[number] | null = null;
    let bestScore = threshold;
    for (const cluster of working) {
      const score = cosineSimilarity(item.embedding, cluster.centroid);
      if (score >= bestScore) {
        // >= mit stabilem Tiebreak über den Key: identische Scores dürfen die
        // Zuordnung nicht von der Iterationsreihenfolge abhängig machen.
        if (best === null || score > bestScore || cluster.key < best.key) {
          best = cluster;
          bestScore = score;
        }
      }
    }

    if (best) {
      best.centroid = updateCentroid(best.centroid, best.count, item.embedding);
      best.count += 1;
      best.memberIds.push(item.id);
      assignments.push({ itemId: item.id, themeKey: best.key, similarity: round5(bestScore) });
      continue;
    }

    working.push({
      key: `new:${item.id}`,
      centroid: item.embedding.slice(),
      count: 1,
      isNew: true,
      memberIds: [item.id],
    });
    assignments.push({ itemId: item.id, themeKey: `new:${item.id}`, similarity: 1 });
  }

  const newThemes: PlannedTheme[] = [];
  const dropped = new Set<string>();
  for (const cluster of working) {
    if (!cluster.isNew) continue;
    if (cluster.memberIds.length < minNewMembers) {
      // Einzelstück: kein Thema. Beim nächsten Lauf erneut prüfen.
      for (const id of cluster.memberIds) dropped.add(id);
      continue;
    }
    newThemes.push({
      key: cluster.key,
      centroid: cluster.centroid,
      memberIds: cluster.memberIds,
    });
  }

  return {
    assignments: assignments.filter((assignment) => !dropped.has(assignment.itemId)),
    newThemes,
    skipped: [...dropped],
  };
}

// ---------------------------------------------------------------------------
// Labeling (deterministisch, kein LLM -> keine Credits, reproduzierbar)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Fehlerberichte',
  feature_request: 'Feature-Wünsche',
  praise: 'Lob',
  complaint: 'Beschwerden',
  question: 'Rückfragen',
  other: 'Sonstiges',
};

export function deriveThemeLabel(items: ClusterableItem[]): {
  label: string;
  keywords: string[];
} {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const topic of item.topics) {
      const key = topic.trim().toLowerCase();
      if (key.length < 2) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([topic]) => topic);

  if (keywords.length > 0) {
    return { label: keywords.slice(0, 2).map(capitalize).join(' / '), keywords };
  }

  const category = items.find((item) => item.category)?.category;
  if (category && CATEGORY_LABELS[category]) {
    return { label: CATEGORY_LABELS[category], keywords: [] };
  }

  const summary = items.find((item) => item.summary?.trim())?.summary?.trim();
  if (summary) return { label: truncate(summary, 60), keywords: [] };
  return { label: 'Unbenanntes Thema', keywords: [] };
}

// ---------------------------------------------------------------------------
// Momentum (median/MAD über lib/scoring/baseline.ts — kein zweites Verfahren)
// ---------------------------------------------------------------------------

export interface Momentum {
  /** 0..1 — direkt als Signal.strength verwendbar. */
  strength: number;
  ratio: number;
  bucket: OutcomeBucket | null;
  recentCount: number;
  previousCount: number;
}

/**
 * Zählt Nennungen in gleich langen Fenstern, ältestes zuerst, letztes = aktuell.
 * Fenster ohne Nennung zählen als 0 — genau das macht "von 2 auf 14" sichtbar.
 */
export function bucketByWindow(
  occurredAt: string[],
  now: Date,
  windowDays = MOMENTUM_WINDOW_DAYS,
  windows = MOMENTUM_WINDOWS
): number[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const end = now.getTime();
  const counts = new Array<number>(windows).fill(0);
  for (const iso of occurredAt) {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time) || time > end) continue;
    const index = windows - 1 - Math.floor((end - time) / windowMs);
    if (index >= 0 && index < windows) counts[index] += 1;
  }
  return counts;
}

/**
 * Der eigentliche Momentum-Wert. `counts` ist die Ausgabe von bucketByWindow.
 *
 * Reihenfolge der Wiederverwendung: computeBaseline über die Historie (log1p +
 * Median/MAD, robust gegen einen einzelnen Ausreißer-Tag), dann classifyOutcome
 * für das aktuelle Fenster. `ratio` daraus ist bereits der Abstand zur eigenen
 * Normalität — genau die Größe, die wir "Beschleunigung" nennen.
 */
export function momentumFromCounts(counts: number[]): Momentum {
  if (counts.length === 0) {
    return { strength: 0, ratio: 1, bucket: null, recentCount: 0, previousCount: 0 };
  }
  const recentCount = counts[counts.length - 1];
  const history = counts.slice(0, -1);
  const previousCount = history.length > 0 ? history[history.length - 1] : 0;

  if (recentCount === 0) {
    return { strength: 0, ratio: 0, bucket: null, recentCount, previousCount };
  }

  const nonEmptyHistory = history.filter((value, index) => value > 0 || index >= firstActive(history));
  if (nonEmptyHistory.length === 0) {
    // Brandneues Thema ohne Historie: Neuheit ist selbst das Signal, aber ohne
    // Vergleichsmaßstab wird sie nicht übertrieben (Deckel 0.6).
    const strength = clamp01(0.25 + recentCount / 25);
    return { strength: Math.min(0.6, strength), ratio: 1, bucket: null, recentCount, previousCount };
  }

  const baseline = computeBaseline(nonEmptyHistory);
  const classified = classifyOutcome(recentCount, baseline);
  const accelerationScore = clamp01(
    Math.log1p(Math.max(0, classified.ratio - 1)) / Math.log1p(4)
  );
  const volumeScore = clamp01(recentCount / 20);
  const strength = clamp01(0.75 * accelerationScore + 0.25 * volumeScore);

  return {
    strength: round5(strength),
    ratio: classified.ratio,
    bucket: classified.bucket,
    recentCount,
    previousCount,
  };
}

// ---------------------------------------------------------------------------
// DB-Pfade
// ---------------------------------------------------------------------------

export interface ClusterRunResult {
  ok: boolean;
  reason?: 'migration_pending' | 'no_embeddings';
  itemsConsidered: number;
  assigned: number;
  newThemes: number;
  themesScored: number;
}

export async function listThemes(
  workspaceId: string,
  options: { limit?: number; minMomentum?: number; includeArchived?: boolean } = {}
): Promise<FeedbackTheme[]> {
  const db = getServiceDb();
  let query = db
    .from('feedback_themes')
    .select(THEME_PUBLIC_COLUMNS)
    .eq('workspace_id', workspaceId) // Invariante 2
    .order('momentum', { ascending: false })
    .limit(Math.min(options.limit ?? 50, MAX_THEMES));
  if (!options.includeArchived) query = query.eq('status', 'active');
  if (typeof options.minMomentum === 'number') {
    query = query.gte('momentum', options.minMomentum);
  }

  const { data, error } = await query.returns<FeedbackThemeRow[]>();
  if (error) {
    // Lesepfad degradiert: ohne Migration 016 keine Themen, aber auch kein 500.
    if (isMissingSchemaError(error.code)) {
      console.error('[themes] feedback_themes fehlt — Migration 016 anwenden:', error.message);
      return [];
    }
    throw new Error(`[themes] theme list failed: ${error.message}`);
  }
  return (data ?? []).map(toTheme);
}

export async function listThemeMemberIds(
  workspaceId: string,
  themeId: string,
  limit = 20
): Promise<string[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_theme_members')
    .select('feedback_item_id, occurred_at')
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('theme_id', themeId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
    .returns<Array<{ feedback_item_id: string }>>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[themes] member lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.feedback_item_id);
}

/**
 * Ein Clustering-Lauf. Idempotent: bereits zugeordnete Feedbacks werden nicht
 * erneut betrachtet, ein zweiter Lauf ohne neue Daten ändert nichts.
 */
export async function clusterFeedbackThemes(
  workspaceId: string,
  options: { now?: Date; maxItems?: number } = {}
): Promise<ClusterRunResult> {
  const now = options.now ?? new Date();
  const db = getServiceDb();
  const empty: ClusterRunResult = {
    ok: true,
    itemsConsidered: 0,
    assigned: 0,
    newThemes: 0,
    themesScored: 0,
  };

  const { data: themeRows, error: themeError } = await db
    .from('feedback_themes')
    .select('id, centroid, member_count')
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('status', 'active')
    .limit(MAX_THEMES)
    .returns<Array<Pick<FeedbackThemeRow, 'id' | 'centroid' | 'member_count'>>>();
  if (themeError) {
    if (isMissingSchemaError(themeError.code)) {
      return { ...empty, ok: false, reason: 'migration_pending' };
    }
    throw new Error(`[themes] theme load failed: ${themeError.message}`);
  }

  const { data: memberRows, error: memberError } = await db
    .from('feedback_theme_members')
    .select('feedback_item_id')
    .eq('workspace_id', workspaceId) // Invariante 2
    .limit(MAX_KNOWN_MEMBERS)
    .returns<Array<{ feedback_item_id: string }>>();
  if (memberError) {
    if (isMissingSchemaError(memberError.code)) {
      return { ...empty, ok: false, reason: 'migration_pending' };
    }
    throw new Error(`[themes] member load failed: ${memberError.message}`);
  }
  const known = new Set((memberRows ?? []).map((row) => row.feedback_item_id));

  const { data: itemRows, error: itemError } = await db
    .from('feedback_items')
    // Kein select('*') — embedding wird gebraucht, verlässt aber dieses Modul nie.
    .select('id, embedding, created_at, source_date, topics, category, summary_de, summary_en')
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('is_duplicate', false)
    .not('embedding', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(options.maxItems ?? MAX_ITEMS_PER_RUN, MAX_ITEMS_PER_RUN))
    .returns<
      Array<{
        id: string;
        embedding: string | number[] | null;
        created_at: string;
        source_date: string | null;
        topics: string[] | null;
        category: string | null;
        summary_de: string | null;
        summary_en: string | null;
      }>
    >();
  if (itemError) {
    if (isMissingSchemaError(itemError.code)) {
      return { ...empty, ok: false, reason: 'migration_pending' };
    }
    throw new Error(`[themes] feedback load failed: ${itemError.message}`);
  }

  const items: ClusterableItem[] = [];
  for (const row of itemRows ?? []) {
    if (known.has(row.id)) continue;
    const embedding = parseVector(row.embedding);
    if (!embedding) continue;
    items.push({
      id: row.id,
      embedding,
      occurredAt: row.source_date ?? row.created_at,
      topics: row.topics ?? [],
      category: row.category,
      summary: row.summary_de ?? row.summary_en,
    });
  }

  const existing: ExistingTheme[] = [];
  for (const row of themeRows ?? []) {
    const centroid = parseVector(row.centroid);
    if (centroid) existing.push({ id: row.id, centroid, memberCount: row.member_count });
  }

  const plan = planClustering(items, existing);
  const itemById = new Map(items.map((item) => [item.id, item]));

  // 1. Neue Themen anlegen (Label deterministisch aus ihren Mitgliedern).
  const keyToThemeId = new Map<string, string>();
  for (const planned of plan.newThemes) {
    const members = planned.memberIds
      .map((id) => itemById.get(id))
      .filter((item): item is ClusterableItem => Boolean(item));
    const { label, keywords } = deriveThemeLabel(members);
    const occurred = members.map((member) => member.occurredAt).sort();
    const { data, error } = await db
      .from('feedback_themes')
      .insert({
        workspace_id: workspaceId,
        label,
        keywords,
        centroid: serializeVector(planned.centroid),
        member_count: planned.memberIds.length,
        first_seen_at: occurred[0] ?? now.toISOString(),
        last_seen_at: occurred[occurred.length - 1] ?? now.toISOString(),
        last_clustered_at: now.toISOString(),
      })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) {
      if (isMissingSchemaError(error?.code)) {
        return { ...empty, ok: false, reason: 'migration_pending' };
      }
      throw new Error(`[themes] theme insert failed: ${error?.message ?? 'no row'}`);
    }
    keyToThemeId.set(planned.key, data.id);
  }

  // 2. Mitgliedschaften schreiben. ignoreDuplicates hält parallele Läufe harmlos.
  const memberInserts = plan.assignments.flatMap((assignment) => {
    const themeId = assignment.themeKey.startsWith('new:')
      ? keyToThemeId.get(assignment.themeKey)
      : assignment.themeKey;
    const item = itemById.get(assignment.itemId);
    if (!themeId || !item) return [];
    return [{
      workspace_id: workspaceId,
      theme_id: themeId,
      feedback_item_id: assignment.itemId,
      similarity: assignment.similarity,
      occurred_at: item.occurredAt,
    }];
  });
  if (memberInserts.length > 0) {
    const { error } = await db
      .from('feedback_theme_members')
      .upsert(memberInserts, {
        onConflict: 'workspace_id,feedback_item_id',
        ignoreDuplicates: true,
      });
    if (error) {
      if (isMissingSchemaError(error.code)) {
        return { ...empty, ok: false, reason: 'migration_pending' };
      }
      throw new Error(`[themes] member insert failed: ${error.message}`);
    }
  }

  // 3. Zentroiden bestehender Themen nachziehen (nur die, die dazugewonnen haben).
  const grownByTheme = new Map<string, string[]>();
  for (const assignment of plan.assignments) {
    if (assignment.themeKey.startsWith('new:')) continue;
    const list = grownByTheme.get(assignment.themeKey) ?? [];
    list.push(assignment.itemId);
    grownByTheme.set(assignment.themeKey, list);
  }
  for (const [themeId, itemIds] of grownByTheme) {
    const base = existing.find((theme) => theme.id === themeId);
    if (!base) continue;
    let centroid = base.centroid;
    let count = Math.max(1, base.memberCount);
    for (const itemId of itemIds) {
      const item = itemById.get(itemId);
      if (!item) continue;
      centroid = updateCentroid(centroid, count, item.embedding);
      count += 1;
    }
    const lastSeen = itemIds
      .map((id) => itemById.get(id)?.occurredAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop();
    const { error } = await db
      .from('feedback_themes')
      .update({
        centroid: serializeVector(centroid),
        member_count: count,
        last_seen_at: lastSeen ?? now.toISOString(),
        last_clustered_at: now.toISOString(),
      })
      .eq('workspace_id', workspaceId) // Invariante 2
      .eq('id', themeId);
    if (error && !isMissingSchemaError(error.code)) {
      console.error('[themes] centroid update failed:', error.message);
    }
  }

  const themesScored = await rescoreMomentum(workspaceId, now);

  return {
    ok: true,
    itemsConsidered: items.length,
    assigned: memberInserts.length,
    newThemes: plan.newThemes.length,
    themesScored,
  };
}

/** Momentum für alle aktiven Themen neu berechnen. Auch ohne neue Zuordnungen sinnvoll. */
export async function rescoreMomentum(workspaceId: string, now = new Date()): Promise<number> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_theme_members')
    .select('theme_id, occurred_at')
    .eq('workspace_id', workspaceId) // Invariante 2
    .limit(MAX_KNOWN_MEMBERS)
    .returns<Array<{ theme_id: string; occurred_at: string }>>();
  if (error) {
    if (isMissingSchemaError(error.code)) return 0;
    throw new Error(`[themes] momentum load failed: ${error.message}`);
  }

  const byTheme = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = byTheme.get(row.theme_id) ?? [];
    list.push(row.occurred_at);
    byTheme.set(row.theme_id, list);
  }

  let scored = 0;
  for (const [themeId, occurrences] of byTheme) {
    const momentum = momentumFromCounts(bucketByWindow(occurrences, now));
    const { error: updateError } = await db
      .from('feedback_themes')
      .update({
        momentum: momentum.strength,
        momentum_ratio: momentum.ratio,
        momentum_bucket: momentum.bucket,
        recent_count: momentum.recentCount,
        previous_count: momentum.previousCount,
        member_count: occurrences.length,
      })
      .eq('workspace_id', workspaceId) // Invariante 2
      .eq('id', themeId);
    if (updateError) {
      if (isMissingSchemaError(updateError.code)) return scored;
      console.error('[themes] momentum update failed:', updateError.message);
      continue;
    }
    scored += 1;
  }
  return scored;
}

// ---------------------------------------------------------------------------

function toTheme(row: FeedbackThemeRow): FeedbackTheme {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    keywords: row.keywords ?? [],
    memberCount: row.member_count,
    recentCount: row.recent_count,
    previousCount: row.previous_count,
    momentum: Number(row.momentum) || 0,
    momentumRatio: row.momentum_ratio === null ? null : Number(row.momentum_ratio),
    momentumBucket: row.momentum_bucket,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
  };
}

function firstActive(history: number[]): number {
  const index = history.findIndex((value) => value > 0);
  return index === -1 ? history.length : index;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round5(value: number): number {
  return Number(value.toFixed(5));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
