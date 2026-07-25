// Signal-Inventar — VERTRAG C3 aus Plan 2 §4.1 (Besitzer 2A, Konsument 2B).
//
// Die Signaturen von SignalKind, Signal, listSignals und getCoverageDays sind
// fixiert: der Fabrik-Strang (2B) programmiert dagegen. Änderungen daran sind
// eine Vertragsänderung, kein Refactor.
//
// `evidence` ist nicht optional und nicht kosmetisch: das Quality-Gate (§6.2,
// Prüfung 1) liest daraus. Ein Signal ohne Evidenz kann nie zu einem Post
// führen, der das Gate besteht. Deshalb hat jede der fünf Quellen unten eine
// explizite Antwort auf "worauf stützt sich das".
//
// Alle fünf Quellen degradieren einzeln: fehlt eine Tabelle (Migration noch
// nicht angewendet) oder schlägt eine Abfrage fehl, liefert diese Quelle nichts
// und die anderen vier arbeiten weiter. Ein leeres Inventar ist ein Zustand,
// kein Fehler.
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { listThemeMemberIds, listThemes } from '@/lib/feedback/themes';
import { listGateUsableProofAssets } from '@/lib/feedback/proof-extraction';

// ---------------------------------------------------------------------------
// Vertrag C3 (§4.1) — nicht ändern
// ---------------------------------------------------------------------------

export type SignalKind =
  | 'feedback_theme'      // wiederkehrendes Thema mit Momentum
  | 'unused_proof'        // belegtes Ergebnis, das nie erzählt wurde
  | 'community_question'  // wiederkehrende Frage aus discovery_communities
  | 'splinter'            // Longform-Baustein
  | 'winner_followup';    // Post, der messbar über Baseline lag

export interface Signal {
  id: string;
  workspaceId: string;
  kind: SignalKind;
  title: string;
  /** Worauf sich das stützt — Basis für die Herkunfts-Kette in der UI. */
  evidence: {
    proofAssetIds: string[];
    feedbackItemIds: string[];
    communityIds: string[];
    referenceIds: string[];
  };
  /** 0..1 — Dringlichkeit. Momentum bei Themen, Baseline-Abstand bei Gewinnern. */
  strength: number;
  /** Nach diesem Zeitpunkt ist das Signal kalt (z. B. Nachrichtenbezug). */
  staleAfter: string | null;
  createdAt: string;
}

export interface ListSignalsOptions {
  minStrength?: number;
  kinds?: SignalKind[];
  limit?: number;
}

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Ein Thema ohne neue Nennungen ist nach drei Wochen kein Anlass mehr. */
const THEME_STALE_DAYS = 21;
/** Zahlen altern. Eine Metrik von vor einem halben Jahr ist kein frischer Beleg. */
const METRIC_STALE_DAYS = 180;
/** Ein Follow-up auf einen Gewinner muss zeitnah kommen, sonst ist der Kontext weg. */
const WINNER_FOLLOWUP_DAYS = 30;

const CORPUS_POSTS = 150;
const COVERAGE_HORIZON_DAYS = 90;

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

export async function listSignals(
  workspaceId: string,
  opts?: ListSignalsOptions
): Promise<Signal[]> {
  const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const wanted = new Set<SignalKind>(
    opts?.kinds && opts.kinds.length > 0
      ? opts.kinds
      : ['feedback_theme', 'unused_proof', 'community_question', 'splinter', 'winner_followup']
  );

  const sources: Array<Promise<Signal[]>> = [];
  if (wanted.has('feedback_theme')) sources.push(guard('themes', themeSignals(workspaceId)));
  if (wanted.has('unused_proof')) sources.push(guard('proofs', unusedProofSignals(workspaceId)));
  if (wanted.has('community_question')) sources.push(guard('communities', communityQuestionSignals(workspaceId)));
  if (wanted.has('splinter')) sources.push(guard('splinters', splinterSignals(workspaceId)));
  if (wanted.has('winner_followup')) sources.push(guard('winners', winnerFollowupSignals(workspaceId)));

  const collected = (await Promise.all(sources)).flat();
  const minStrength = opts?.minStrength ?? 0;

  return collected
    .filter((signal) => signal.strength >= minStrength)
    .sort((left, right) => right.strength - left.strength || left.id.localeCompare(right.id))
    .slice(0, limit);
}

/**
 * Tage, für die geplanter Content vorhanden ist. Speist die Reichweiten-Ampel.
 *
 * Gezählt werden DISTINKTE künftige Kalendertage mit mindestens einem geplanten
 * Post — nicht die Anzahl Posts. "Ich habe Stoff für 12 Tage" ist die Frage,
 * nicht "ich habe 12 Posts" (die könnten alle morgen liegen).
 */
export async function getCoverageDays(workspaceId: string): Promise<number> {
  const db = getServiceDb();
  const now = new Date();
  const horizon = new Date(now.getTime() + COVERAGE_HORIZON_DAYS * DAY_MS);

  const { data, error } = await db
    .from('post_groups')
    .select('scheduled_at, scheduled_tz')
    .eq('workspace_id', workspaceId) // Invariante 2
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(500)
    .returns<Array<{ scheduled_at: string | null; scheduled_tz: string | null }>>();
  if (error) {
    if (isMissingSchemaError(error.code)) return 0;
    console.error('[inventory] coverage query failed:', error.message);
    return 0;
  }

  return countCoverageDays((data ?? []).map((row) => row.scheduled_at), now);
}

/**
 * Rein und damit testbar: wie viele verschiedene künftige Kalendertage sind belegt.
 * Zeitzone bewusst UTC — die Ampel ist eine Größenordnung, keine Uhrzeit.
 */
export function countCoverageDays(scheduledAt: Array<string | null>, now: Date): number {
  const days = new Set<string>();
  for (const iso of scheduledAt) {
    if (!iso) continue;
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time) || time < now.getTime()) continue;
    days.add(new Date(time).toISOString().slice(0, 10));
  }
  return days.size;
}

// ---------------------------------------------------------------------------
// Quelle 1 — Feedback-Themen mit Momentum
// ---------------------------------------------------------------------------

async function themeSignals(workspaceId: string): Promise<Signal[]> {
  const themes = await listThemes(workspaceId, { limit: 25 });
  const signals: Signal[] = [];
  for (const theme of themes) {
    if (theme.memberCount < 2) continue;
    const feedbackItemIds = await listThemeMemberIds(workspaceId, theme.id, 10);
    signals.push({
      id: `theme:${theme.id}`,
      workspaceId,
      kind: 'feedback_theme',
      title: `${theme.label}: ${theme.memberCount} Nennungen (${theme.recentCount} zuletzt)`,
      evidence: {
        proofAssetIds: [],
        feedbackItemIds,
        communityIds: [],
        referenceIds: [],
      },
      strength: clamp01(theme.momentum),
      staleAfter: shiftDays(theme.lastSeenAt, THEME_STALE_DAYS),
      createdAt: theme.firstSeenAt,
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Quelle 2 — Belege, die nie erzählt wurden
// ---------------------------------------------------------------------------

/**
 * "Unbenutzt" ohne eigene Verwendungstabelle: der Beleg taucht in keinem
 * veröffentlichten Post wörtlich auf. Rein und testbar; bewusst konservativ —
 * lieber einmal zu viel vorschlagen als einen guten Beleg verschweigen.
 */
export function isProofReferenced(proofContent: string, corpus: string): boolean {
  const proofWords = normalizeForMatch(proofContent).split(' ').filter(Boolean);
  if (proofWords.length === 0) return false;
  const normalizedCorpus = normalizeForMatch(corpus);
  if (normalizedCorpus.length === 0) return false;

  const size = Math.min(6, proofWords.length);
  for (let i = 0; i + size <= proofWords.length; i += 1) {
    const shingle = proofWords.slice(i, i + size).join(' ');
    if (shingle.length >= 12 && normalizedCorpus.includes(shingle)) return true;
  }
  return false;
}

async function unusedProofSignals(workspaceId: string): Promise<Signal[]> {
  const [assets, corpus] = await Promise.all([
    listGateUsableProofAssets(workspaceId, { limit: 50 }),
    loadPublishedCorpus(workspaceId),
  ]);

  const now = Date.now();
  return assets
    .filter((asset) => !isProofReferenced(asset.content, corpus))
    .map((asset) => {
      const ageDays = (now - new Date(asset.createdAt).getTime()) / DAY_MS;
      const recency = clamp01(1 - ageDays / METRIC_STALE_DAYS);
      const strength = clamp01(0.45 + (asset.verifiedAt ? 0.2 : 0) + 0.25 * recency);
      return {
        id: `proof:${asset.id}`,
        workspaceId,
        kind: 'unused_proof' as const,
        title: `Unerzählter Beleg: ${truncate(asset.content, 90)}`,
        evidence: {
          proofAssetIds: [asset.id],
          feedbackItemIds: [],
          communityIds: [],
          referenceIds: [],
        },
        strength: round4(strength),
        staleAfter: asset.type === 'metric' ? shiftDays(asset.createdAt, METRIC_STALE_DAYS) : null,
        createdAt: asset.createdAt,
      };
    });
}

// ---------------------------------------------------------------------------
// Quelle 3 — wiederkehrende Community-Fragen
// ---------------------------------------------------------------------------
// discovery_communities.top_questions wird seit dem Discovery-Layer erhoben und
// bisher NIRGENDS gelesen (community-mapper.ts schreibt es, sonst nichts).
// Hier bekommt es endlich einen Konsumenten.

interface CommunityQuestionRow {
  id: string;
  community_name: string;
  relevance_score: number | null;
  top_questions: unknown;
  last_scanned_at: string | null;
}

/** Rein: gleiche Frage aus mehreren Communities zählt stärker, nicht doppelt. */
export function aggregateCommunityQuestions(
  rows: Array<{ id: string; relevanceScore: number | null; questions: string[] }>
): Array<{ question: string; communityIds: string[]; strength: number }> {
  const byQuestion = new Map<string, { question: string; communityIds: string[]; scores: number[] }>();
  for (const row of rows) {
    for (const raw of row.questions) {
      const question = raw.trim();
      if (question.length < 8) continue;
      const key = question.toLowerCase();
      const entry = byQuestion.get(key) ?? { question, communityIds: [], scores: [] };
      if (!entry.communityIds.includes(row.id)) entry.communityIds.push(row.id);
      entry.scores.push(clamp01((row.relevanceScore ?? 50) / 100));
      byQuestion.set(key, entry);
    }
  }

  return [...byQuestion.values()]
    .map((entry) => {
      const relevance = entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length;
      const repetition = clamp01((entry.communityIds.length - 1) / 3);
      return {
        question: entry.question,
        communityIds: entry.communityIds,
        strength: round4(clamp01(0.35 + 0.4 * relevance + 0.25 * repetition)),
      };
    })
    .sort((left, right) => right.strength - left.strength || left.question.localeCompare(right.question));
}

async function communityQuestionSignals(workspaceId: string): Promise<Signal[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('discovery_communities')
    .select('id, community_name, relevance_score, top_questions, last_scanned_at')
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('is_active', true)
    .order('relevance_score', { ascending: false })
    .limit(50)
    .returns<CommunityQuestionRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[inventory] community query failed: ${error.message}`);
  }

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    relevanceScore: row.relevance_score,
    questions: toStringArray(row.top_questions),
    lastScannedAt: row.last_scanned_at,
  }));
  const scannedById = new Map(rows.map((row) => [row.id, row.lastScannedAt]));

  return aggregateCommunityQuestions(rows).slice(0, 25).map((entry) => ({
    id: `question:${entry.communityIds[0]}:${slug(entry.question)}`,
    workspaceId,
    kind: 'community_question' as const,
    title: entry.question,
    evidence: {
      proofAssetIds: [],
      feedbackItemIds: [],
      communityIds: entry.communityIds,
      referenceIds: [],
    },
    strength: entry.strength,
    // Wiederkehrende Fragen veralten nicht — sie sind der Dauerbrenner-Stoff.
    staleAfter: null,
    createdAt: scannedById.get(entry.communityIds[0]) ?? new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Quelle 4 — Longform-Bausteine (Splinter)
// ---------------------------------------------------------------------------
// Bewusst KEIN Aufruf von splinterPillar(): das kostet Credits und einen
// LLM-Call. Das Inventar sagt nur, WELCHER Stoff da liegt — gesplittert wird
// erst, wenn jemand das Signal aufgreift.

interface ContentSourceSignalRow {
  id: string;
  title: string | null;
  body_md: string;
  status: 'new' | 'splintered' | 'archived';
  splinters: unknown;
  created_at: string;
}

async function splinterSignals(workspaceId: string): Promise<Signal[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_sources')
    .select('id, title, body_md, status, splinters, created_at')
    .eq('workspace_id', workspaceId) // Invariante 2
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(30)
    .returns<ContentSourceSignalRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[inventory] content source query failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => row.body_md.trim().length >= 200)
    .map((row) => {
      const pending = Array.isArray(row.splinters) ? row.splinters.length : 0;
      // Ungesplitterter Stoff ist wertvoller als schon zerlegter.
      const lengthScore = clamp01(row.body_md.length / 8000);
      const strength = clamp01(
        (row.status === 'new' ? 0.55 : 0.35) + 0.25 * lengthScore + (pending > 0 ? 0.1 : 0)
      );
      return {
        id: `splinter:${row.id}`,
        workspaceId,
        kind: 'splinter' as const,
        title: `Longform-Baustein: ${truncate(row.title?.trim() || row.body_md, 80)}`,
        evidence: {
          proofAssetIds: [],
          feedbackItemIds: [],
          communityIds: [],
          referenceIds: [],
        },
        strength: round4(strength),
        staleAfter: null,
        createdAt: row.created_at,
      };
    });
}

// ---------------------------------------------------------------------------
// Quelle 5 — Gewinner über Baseline
// ---------------------------------------------------------------------------
// reconcile.ts schreibt outcome_bucket/outcome_ratio nach 48h in
// impact_predictions. 'above'/'outlier' heißt: dieser Post lag messbar über der
// eigenen Baseline — das ist der belastbarste Post-Anlass, den das System hat.

interface WinnerRow {
  id: string;
  post_item_id: string | null;
  platform: string;
  outcome_bucket: 'below' | 'inline' | 'above' | 'outlier' | null;
  outcome_ratio: number | null;
  baseline_n: number | null;
  outcome_at: string | null;
  detected_framework: string | null;
}

/** Rein: Baseline-Abstand -> 0..1. Kleine Baselines werden gedämpft, nicht verworfen. */
export function winnerStrength(ratio: number | null, baselineN: number | null): number {
  const value = typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : 1;
  const distance = clamp01(Math.log1p(Math.max(0, value - 1)) / Math.log1p(4));
  const confidence = clamp01((baselineN ?? 0) / 20);
  return round4(clamp01(0.3 + 0.5 * distance + 0.2 * confidence));
}

async function winnerFollowupSignals(workspaceId: string): Promise<Signal[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('impact_predictions')
    .select('id, post_item_id, platform, outcome_bucket, outcome_ratio, baseline_n, outcome_at, detected_framework')
    .eq('workspace_id', workspaceId) // Invariante 2
    .in('outcome_bucket', ['above', 'outlier'])
    .not('outcome_at', 'is', null)
    .order('outcome_at', { ascending: false })
    .limit(20)
    .returns<WinnerRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[inventory] winner query failed: ${error.message}`);
  }

  const rows = data ?? [];
  const referenceIdByFramework = await matchReferences(
    workspaceId,
    rows.map((row) => row.detected_framework).filter((value): value is string => Boolean(value))
  );

  return rows.map((row) => {
    const referenceId = row.detected_framework
      ? referenceIdByFramework.get(row.detected_framework.toLowerCase())
      : undefined;
    return {
      id: `winner:${row.id}`,
      workspaceId,
      kind: 'winner_followup' as const,
      title:
        `Gewinner auf ${row.platform}${row.outcome_ratio ? ` (${row.outcome_ratio.toFixed(1)}× Baseline)` : ''}` +
        `${row.detected_framework ? ` — Muster: ${row.detected_framework}` : ''}`,
      evidence: {
        proofAssetIds: [],
        feedbackItemIds: [],
        communityIds: [],
        referenceIds: referenceId ? [referenceId] : [],
      },
      strength: winnerStrength(row.outcome_ratio, row.baseline_n),
      staleAfter: row.outcome_at ? shiftDays(row.outcome_at, WINNER_FOLLOWUP_DAYS) : null,
      createdAt: row.outcome_at ?? new Date().toISOString(),
    };
  });
}

/** Ordnet erkannte Frameworks den kuratierten content_references zu (Mig. 013). */
async function matchReferences(
  workspaceId: string,
  frameworks: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (frameworks.length === 0) return result;
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_references')
    .select('id, reference_type, relevance_tags')
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .limit(100)
    .returns<Array<{ id: string; reference_type: string; relevance_tags: string[] }>>();
  if (error) {
    if (!isMissingSchemaError(error.code)) {
      console.error('[inventory] reference match failed:', error.message);
    }
    return result;
  }
  for (const framework of new Set(frameworks.map((value) => value.toLowerCase()))) {
    const match = (data ?? []).find(
      (row) =>
        row.reference_type.toLowerCase() === framework ||
        (row.relevance_tags ?? []).some((tag) => tag.toLowerCase() === framework)
    );
    if (match) result.set(framework, match.id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

async function loadPublishedCorpus(workspaceId: string): Promise<string> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('resolved_content, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', workspaceId) // Invariante 2
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(CORPUS_POSTS)
    .returns<Array<{ resolved_content: string | null }>>();
  if (error) {
    if (!isMissingSchemaError(error.code)) {
      console.error('[inventory] corpus query failed:', error.message);
    }
    return '';
  }
  return (data ?? []).map((row) => row.resolved_content ?? '').join('\n');
}

/** Eine kaputte Quelle darf das Inventar nicht leeren. */
async function guard(label: string, promise: Promise<Signal[]>): Promise<Signal[]> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[inventory] source '${label}' failed:`, error);
    return [];
  }
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%€$.,]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function shiftDays(iso: string, days: number): string | null {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * DAY_MS).toISOString();
}

function slug(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, '-').slice(0, 48);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
