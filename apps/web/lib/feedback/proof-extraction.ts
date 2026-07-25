// Proof-Extraktion aus eingehendem Feedback (Plan 2 / 2A.3, Migration 016).
//
// HARTE REGEL, ohne Ausnahme: hier entsteht NIE automatisch ein proof_asset.
// Der Weg ist immer Vorschlag -> menschliche Bestätigung -> proof_asset.
// Ein automatisch erzeugter "Beleg" wäre exakt die Fabrikation, gegen die das
// gesamte Proof-Konzept (Migration 012) gebaut wurde.
//
// Zweite Entscheidung mit Absicht: die Extraktion ist DETERMINISTISCH und
// zitiert WÖRTLICH. Kein LLM. Der im Plan (§8) genannte Fehlermodus "LLM
// erfindet einen Beleg aus vagem Feedback" kann so gar nicht erst auftreten —
// ein Vorschlag ist immer ein unveränderter Satz aus der Quelle, und die Quelle
// hängt an jedem Vorschlag. Nebenwirkung: kostet null Credits und ist testbar.
//
// DSGVO (Plan 2 §8): personenbezogene Aussagen (Kundenzitate) tragen
// requires_consent. Beim Übernehmen wird daraus consent_status='pending' — und
// solange der nicht 'granted' ist, ist der Beleg im Quality-Gate NICHT
// verwendbar (isProofUsableInGate / listGateUsableProofAssets, von 2B genutzt).
//
// Row-Types stehen LOKAL statt in lib/db.ts, weil Plan 2 zwei Agenten parallel
// laufen lässt und lib/db.ts in diesem Lauf dem anderen Strang gehört.
import type { ProofAssetType } from '@prolora/shared';
import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type ProofConsentStatus = 'not_required' | 'pending' | 'granted' | 'denied';
export type ProofSuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface ProofSuggestionRow {
  id: string;
  workspace_id: string;
  feedback_item_id: string | null;
  suggested_type: ProofAssetType;
  content: string;
  source_url: string | null;
  source_author: string | null;
  source_platform: string | null;
  rationale: string | null;
  confidence: number;
  requires_consent: boolean;
  status: ProofSuggestionStatus;
  decided_at: string | null;
  decided_by: string | null;
  proof_asset_id: string | null;
  created_at: string;
}

export const PROOF_SUGGESTION_COLUMNS = [
  'id', 'workspace_id', 'feedback_item_id', 'suggested_type', 'content', 'source_url',
  'source_author', 'source_platform', 'rationale', 'confidence', 'requires_consent',
  'status', 'decided_at', 'decided_by', 'proof_asset_id', 'created_at',
].join(', ');

export interface ProofSuggestion {
  id: string;
  feedbackItemId: string | null;
  type: ProofAssetType;
  content: string;
  sourceUrl: string | null;
  sourceAuthor: string | null;
  sourcePlatform: string | null;
  rationale: string | null;
  confidence: number;
  requiresConsent: boolean;
  status: ProofSuggestionStatus;
  proofAssetId: string | null;
  createdAt: string;
}

/**
 * Nur diese Zustände darf das Quality-Gate (Plan 2 §6.2, Prüfung 1) als Beleg
 * akzeptieren. 'pending'/'denied' bedeutet: da fehlt die Rechtsgrundlage.
 */
export const PROOF_GATE_USABLE_STATUSES: readonly ProofConsentStatus[] = [
  'not_required',
  'granted',
];

export interface GateUsableProofAsset {
  id: string;
  type: ProofAssetType;
  content: string;
  sourceUrl: string | null;
  verifiedAt: string | null;
  consentStatus: ProofConsentStatus;
  createdAt: string;
}

export function isProofUsableInGate(asset: {
  consent_status?: ProofConsentStatus | null;
}): boolean {
  // Zeilen aus der Zeit vor Migration 016 haben keine Spalte -> undefined.
  // Die sind eigene Metriken/Beobachtungen und bleiben nutzbar.
  const status = asset.consent_status ?? 'not_required';
  return PROOF_GATE_USABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Reine Extraktion (unit-getestet)
// ---------------------------------------------------------------------------

export interface ProofCandidate {
  type: ProofAssetType;
  /** Wörtlich aus der Quelle. Nie umformuliert. */
  content: string;
  rationale: string;
  confidence: number;
  requiresConsent: boolean;
}

const MAX_CANDIDATES_PER_ITEM = 3;
const MIN_SENTENCE_CHARS = 20;
const MAX_SENTENCE_CHARS = 400;

/** Zahl mit Einheit/Prozent/Währung/Faktor — der harte Kern eines Belegs. */
const MEASURABLE = /(\d+[.,]?\d*\s?%|\d+[.,]?\d*\s?(?:x|mal)\b|[€$]\s?\d|\d+[.,]?\d*\s?(?:eur|euro|usd|dollar)\b|\d+[.,]?\d*\s?(?:std|stunden?|minuten?|min|tage?|wochen?|monate?)\b)/i;
/** Ergebnis-Verben (de/en). Ohne die ist eine Zahl nur eine Zahl. */
const OUTCOME_WORDS = /(reduziert|gesunken|gestiegen|spart|gespart|weniger|mehr|schneller|halbiert|verdoppelt|verdreifacht|gewachsen|zugelegt|rückgang|anstieg|steigerung|senkung|reduced|saved|increased|decreased|faster|doubled|tripled|grew|dropped)/i;
/** Erste Person = eine Aussage über die eigene Erfahrung, kein Marketingsatz. */
const FIRST_PERSON = /\b(ich|wir|mein|unser|unsere|meine|uns|i|we|our|my)\b/i;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export interface FeedbackSourceMeta {
  sourceAuthor: string | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  sentiment?: string | null;
}

/**
 * Findet belegbare Aussagen. Zwei Sorten, in dieser Rangfolge:
 *  - `metric`: messbares Ergebnis (Zahl + Ergebnis-Verb).
 *  - `customer_quote`: erste-Person-Aussage einer identifizierbaren Person.
 *
 * Gibt IMMER Kandidaten zurück, nie Assets. Konfidenz ist absichtlich
 * konservativ — sie sortiert die Liste für den Menschen, sie ersetzt ihn nicht.
 */
export function extractProofCandidates(
  text: string,
  meta: FeedbackSourceMeta
): ProofCandidate[] {
  const identifiable = Boolean(meta.sourceAuthor?.trim());
  const candidates: ProofCandidate[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    if (sentence.length < MIN_SENTENCE_CHARS || sentence.length > MAX_SENTENCE_CHARS) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;

    const measurable = MEASURABLE.test(sentence);
    const outcome = OUTCOME_WORDS.test(sentence);
    const firstPerson = FIRST_PERSON.test(sentence);

    if (measurable && outcome) {
      seen.add(key);
      candidates.push({
        type: 'metric',
        content: sentence,
        rationale: 'Enthält eine konkrete Zahl zusammen mit einer Ergebnis-Aussage.',
        confidence: firstPerson ? 0.8 : 0.65,
        // Eine Zahl ist kein personenbezogenes Datum — es sei denn, sie hängt
        // an einer benennbaren Person, dann gilt dasselbe wie beim Zitat.
        requiresConsent: identifiable,
      });
      continue;
    }

    if (firstPerson && identifiable && (outcome || measurable)) {
      seen.add(key);
      candidates.push({
        type: 'customer_quote',
        content: sentence,
        rationale: 'Aussage einer identifizierbaren Person in der ersten Person.',
        confidence: 0.55,
        requiresConsent: true, // DSGVO: Kundenzitat immer.
      });
    }
  }

  return candidates
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, MAX_CANDIDATES_PER_ITEM);
}

// ---------------------------------------------------------------------------
// DB-Pfade
// ---------------------------------------------------------------------------

const MIGRATION_PENDING = new ApiError(
  503,
  'Proof-Vorschläge sind noch nicht eingerichtet — supabase/migrations/016_feedback_themes.sql anwenden.',
  'migration_pending'
);

const MAX_SCAN_ITEMS = 200;
const MAX_SUGGESTIONS = 100;

export interface ScanResult {
  ok: boolean;
  reason?: 'migration_pending';
  itemsScanned: number;
  suggestionsCreated: number;
}

/**
 * Durchsucht die jüngsten Feedbacks und legt PENDING-Vorschläge an.
 * Legt niemals ein proof_asset an — das kann nur acceptProofSuggestion.
 */
export async function scanFeedbackForProofs(
  workspaceId: string,
  options: { limit?: number } = {}
): Promise<ScanResult> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_items')
    .select('id, original_content, source_author, source_platform, source_url, sentiment')
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('is_duplicate', false)
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? MAX_SCAN_ITEMS, MAX_SCAN_ITEMS))
    .returns<
      Array<{
        id: string;
        original_content: string;
        source_author: string | null;
        source_platform: string | null;
        source_url: string | null;
        sentiment: string | null;
      }>
    >();
  if (error) {
    if (isMissingSchemaError(error.code)) {
      return { ok: false, reason: 'migration_pending', itemsScanned: 0, suggestionsCreated: 0 };
    }
    throw new Error(`[proof-extraction] feedback load failed: ${error.message}`);
  }

  const rows = data ?? [];
  const inserts = rows.flatMap((row) =>
    extractProofCandidates(row.original_content, {
      sourceAuthor: row.source_author,
      sourcePlatform: row.source_platform,
      sourceUrl: row.source_url,
      sentiment: row.sentiment,
    }).map((candidate) => ({
      workspace_id: workspaceId,
      feedback_item_id: row.id,
      suggested_type: candidate.type,
      content: candidate.content,
      source_url: row.source_url,
      source_author: row.source_author,
      source_platform: row.source_platform,
      rationale: candidate.rationale,
      confidence: candidate.confidence,
      requires_consent: candidate.requiresConsent,
    }))
  );

  if (inserts.length === 0) {
    return { ok: true, itemsScanned: rows.length, suggestionsCreated: 0 };
  }

  // UNIQUE(workspace_id, feedback_item_id, content) + ignoreDuplicates: ein
  // erneuter Scan erzeugt keine Dubletten und überschreibt keine Entscheidung.
  const { data: inserted, error: insertError } = await db
    .from('proof_suggestions')
    .upsert(inserts, {
      onConflict: 'workspace_id,feedback_item_id,content',
      ignoreDuplicates: true,
    })
    .select('id');
  if (insertError) {
    if (isMissingSchemaError(insertError.code)) {
      return { ok: false, reason: 'migration_pending', itemsScanned: rows.length, suggestionsCreated: 0 };
    }
    throw new Error(`[proof-extraction] suggestion insert failed: ${insertError.message}`);
  }

  return {
    ok: true,
    itemsScanned: rows.length,
    suggestionsCreated: (inserted ?? []).length,
  };
}

export async function listProofSuggestions(
  workspaceId: string,
  options: { status?: ProofSuggestionStatus; limit?: number } = {}
): Promise<ProofSuggestion[]> {
  const db = getServiceDb();
  let query = db
    .from('proof_suggestions')
    .select(PROOF_SUGGESTION_COLUMNS)
    .eq('workspace_id', workspaceId) // Invariante 2
    .order('confidence', { ascending: false })
    .limit(Math.min(options.limit ?? 50, MAX_SUGGESTIONS));
  if (options.status) query = query.eq('status', options.status);

  const { data, error } = await query.returns<ProofSuggestionRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) {
      console.error('[proof-extraction] proof_suggestions fehlt — Migration 016 anwenden:', error.message);
      return [];
    }
    throw new Error(`[proof-extraction] suggestion list failed: ${error.message}`);
  }
  return (data ?? []).map(toSuggestion);
}

export interface AcceptInput {
  /**
   * Beleg der Zustimmung (E-Mail-Betreff, Ticket-Link, Vertragsklausel).
   * Fehlt er bei einem zustimmungspflichtigen Vorschlag, wird der Beleg
   * angelegt — aber mit consent_status='pending' und damit im Gate unbrauchbar.
   */
  consentReference?: string | null;
  decidedBy?: string | null;
}

export interface AcceptResult {
  proofAssetId: string;
  consentStatus: ProofConsentStatus;
  usableInGate: boolean;
}

/**
 * Der einzige Weg, aus einem Vorschlag einen Beleg zu machen. Bewusst als
 * expliziter Aufruf mit Nutzerkontext, nicht als Nebenwirkung eines Scans.
 */
export async function acceptProofSuggestion(
  workspaceId: string,
  suggestionId: string,
  input: AcceptInput = {}
): Promise<AcceptResult> {
  const db = getServiceDb();
  const { data: suggestion, error: loadError } = await db
    .from('proof_suggestions')
    .select(PROOF_SUGGESTION_COLUMNS)
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('id', suggestionId)
    .maybeSingle<ProofSuggestionRow>();
  if (loadError) {
    if (isMissingSchemaError(loadError.code)) throw MIGRATION_PENDING;
    throw new Error(`[proof-extraction] suggestion lookup failed: ${loadError.message}`);
  }
  if (!suggestion) throw new ApiError(404, 'Proof-Vorschlag nicht gefunden.', 'not_found');
  if (suggestion.status === 'accepted' && suggestion.proof_asset_id) {
    throw new ApiError(409, 'Dieser Vorschlag wurde bereits übernommen.', 'already_accepted');
  }

  const consentReference = input.consentReference?.trim() || null;
  const consentStatus: ProofConsentStatus = suggestion.requires_consent
    ? consentReference
      ? 'granted'
      : 'pending'
    : 'not_required';

  const now = new Date().toISOString();
  const { data: asset, error: insertError } = await db
    .from('proof_assets')
    .insert({
      workspace_id: workspaceId,
      type: suggestion.suggested_type,
      content: suggestion.content,
      source_url: suggestion.source_url,
      source_author: suggestion.source_author,
      source_feedback_item_id: suggestion.feedback_item_id,
      origin: 'feedback_suggestion',
      consent_status: consentStatus,
      consent_reference: consentReference,
      consent_recorded_at: consentStatus === 'granted' ? now : null,
    })
    .select('id')
    .single<{ id: string }>();
  if (insertError || !asset) {
    if (isMissingSchemaError(insertError?.code)) throw MIGRATION_PENDING;
    throw new Error(`[proof-extraction] proof asset insert failed: ${insertError?.message ?? 'no row'}`);
  }

  const { error: updateError } = await db
    .from('proof_suggestions')
    .update({
      status: 'accepted',
      decided_at: now,
      decided_by: input.decidedBy ?? null,
      proof_asset_id: asset.id,
    })
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('id', suggestionId);
  if (updateError) {
    console.error('[proof-extraction] suggestion update failed:', updateError.message);
  }

  return {
    proofAssetId: asset.id,
    consentStatus,
    usableInGate: isProofUsableInGate({ consent_status: consentStatus }),
  };
}

export async function rejectProofSuggestion(
  workspaceId: string,
  suggestionId: string,
  decidedBy?: string | null
): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('proof_suggestions')
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: decidedBy ?? null,
    })
    .eq('workspace_id', workspaceId) // Invariante 2
    .eq('id', suggestionId)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[proof-extraction] suggestion reject failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * Belege, die das Quality-Gate verwenden DARF. 2B ruft das für Prüfung 1.
 * Vor Migration 016 fehlt consent_status — dann greift der Fallback in
 * isProofUsableInGate und alles Bestehende bleibt nutzbar.
 */
export async function listGateUsableProofAssets(
  workspaceId: string,
  options: { ids?: string[]; limit?: number } = {}
): Promise<GateUsableProofAsset[]> {
  const db = getServiceDb();
  const columns = 'id, type, content, source_url, verified_at, consent_status, created_at';
  const run = async (withConsent: boolean) => {
    let query = db
      .from('proof_assets')
      .select(withConsent ? columns : 'id, type, content, source_url, verified_at, created_at')
      .eq('workspace_id', workspaceId) // Invariante 2
      .order('created_at', { ascending: false })
      .limit(Math.min(options.limit ?? 50, 200));
    if (options.ids && options.ids.length > 0) query = query.in('id', options.ids);
    return query.returns<
      Array<{
        id: string;
        type: ProofAssetType;
        content: string;
        source_url: string | null;
        verified_at: string | null;
        consent_status?: ProofConsentStatus | null;
        created_at: string;
      }>
    >();
  };

  let { data, error } = await run(true);
  if (error && isMissingSchemaError(error.code)) {
    // Migration 016 fehlt: ohne consent_status weiterlesen statt zu crashen.
    ({ data, error } = await run(false));
  }
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[proof-extraction] proof asset list failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => isProofUsableInGate(row))
    .map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      sourceUrl: row.source_url,
      verifiedAt: row.verified_at,
      consentStatus: row.consent_status ?? 'not_required',
      createdAt: row.created_at,
    }));
}

// ---------------------------------------------------------------------------

function toSuggestion(row: ProofSuggestionRow): ProofSuggestion {
  return {
    id: row.id,
    feedbackItemId: row.feedback_item_id,
    type: row.suggested_type,
    content: row.content,
    sourceUrl: row.source_url,
    sourceAuthor: row.source_author,
    sourcePlatform: row.source_platform,
    rationale: row.rationale,
    confidence: Number(row.confidence) || 0,
    requiresConsent: row.requires_consent,
    status: row.status,
    proofAssetId: row.proof_asset_id,
    createdAt: row.created_at,
  };
}
