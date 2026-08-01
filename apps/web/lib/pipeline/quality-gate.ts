// Plan 2 / 2B.2 — Das blockierende Qualitäts-Gate (Vertrag C4).
//
// Warum es blockiert (Entscheidung D1): Ein Gate ohne Nein ist eine Bitte, und
// Bitten skalieren nicht auf ~720 Veröffentlichungen im Monat. Übersteuern ist
// erlaubt — aber nur mit Protokoll (lib/pipeline/state.ts: recordGateOverride).
//
// Prüfung 1 ist die Durchsetzung der Anti-Fabrikations-Invariante, die seit
// Migration 012 im Datenmodell angelegt, aber nie erzwungen war: eine Zahl ohne
// Beleg wird BLOCKIERT, nicht kommentiert.
//
// Ein Wort zu `GateFinding.passed` bei übersprungenen Prüfungen: eine
// übersprungene Prüfung hat NICHT bestanden — sie fand nicht statt. Deshalb
// `passed: false` UND `status: 'skipped'`. Blockierend ist ausschließlich
// `status === 'failed'`; `GateResult.passed` ist die maßgebliche Aussage.
// Andernfalls würde "keine Historie" als Qualitätsnachweis gelesen (§8).
import type { AppLocale, PlatformType } from '@prolora/shared';
import { runDeterministicChecks } from '@/lib/scoring/deterministic';
import { getPlatformRules } from '@/lib/validation/platform-rules';
import { runNarrativeChecks, type NarrativeGateContext } from './narrative-judge';

// --- Vertrag C4 (§4.2) ----------------------------------------------------

export type GateCheck =
  | 'proof_binding'
  | 'language'
  | 'mention'
  | 'sample_copy'
  | 'narrative_consistency'
  | 'structure'
  | 'deterministic'
  | 'self_similarity';

export type GateRemedy =
  | 'add_proof'
  | 'rewrite_structure'
  | 'shorten'
  | 'differentiate'
  | 'correct_language'
  | 'remove_mention'
  | 'place_mention'
  | 'needs_input'
  | null;

/** Erweiterung über C4 hinaus — siehe Datei-Header. */
export type GateFindingStatus = 'passed' | 'failed' | 'skipped';

export interface GateFinding {
  check: GateCheck;
  passed: boolean;
  /** Für den Menschen, in der UI-Sprache des Workspaces. */
  message: string;
  /** Maschinenlesbar, damit die UI die richtige Reparatur-Aktion anbietet. */
  remedy: GateRemedy;
  /** Textstelle, die das Problem auslöst — für Inline-Markierung. */
  span: { start: number; end: number } | null;
  /** 'skipped' ist ausdrücklich nicht 'passed'. */
  status: GateFindingStatus;
}

export interface GateResult {
  passed: boolean;
  findings: GateFinding[];
  /** Gesetzt, wenn der Nutzer bewusst übersteuert hat. Wird protokolliert. */
  overriddenBy: string | null;
}

// --- Schwellen (konfigurierbar — Failure Mode "Gate blockiert alles") ------

export interface GateThresholds {
  proofBinding: {
    /** "3 Dinge, die ich gelernt habe" ist keine überprüfbare Behauptung. */
    ignoreStructuralCounts: boolean;
    /** Jahreszahlen ohne Einheit (1900–2100) sind keine Leistungsbehauptung. */
    ignoreYears: boolean;
    /** "doppelt so schnell" ist ein Vergleich und braucht ebenfalls einen Beleg. */
    requireProofForComparatives: boolean;
    /**
     * "drastisch gesunken" behauptet ein Ergebnis, ohne es zu beziffern.
     * Bewusst eine EIGENE Schwelle: multiplikative Vergleiche und vage
     * Steigerungen sind zwei verschiedene Fehlerbilder mit zwei verschiedenen
     * Falsch-Positiv-Risiken und müssen getrennt abschaltbar sein.
     */
    requireProofForVagueMagnitude: boolean;
  };
  structure: {
    requiredFields: string[];
  };
  deterministic: {
    /** Summe aus formatting_score (max 20) + platform_hygiene_score (max 20). */
    minTotalScore: number;
    /** Über dem Zeichenlimit wird immer blockiert, unabhängig von der Punktzahl. */
    hardFailOnCharacterLimit: boolean;
  };
  selfSimilarity: {
    /** Unter dieser Historie wird Prüfung 4 übersprungen, nicht bestanden. */
    minHistory: number;
    /** Kosinus-Ähnlichkeit, ab der ein Entwurf als Wiederholung gilt. */
    maxSimilarity: number;
    windowDays: number;
  };
}

/**
 * Resonanz-Schema aus Migration 013. `reibungsfrage` ist bewusst NICHT
 * pflichtig: die vorhandene Einstellung "Community-Verbindlichkeit 1/5"
 * erlaubt ausdrücklich einen Post ganz ohne Frage — das Gate darf eine
 * unterstützte Produkteinstellung nicht verbieten.
 */
export const RESONANCE_FIELDS = [
  'beweisbarer_ausgangspunkt',
  'bruch',
  'unerwarteter_befund',
  'mechanismus',
  'handlungsregel',
  'reibungsfrage',
] as const;

export type ResonanceField = (typeof RESONANCE_FIELDS)[number];

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  proofBinding: {
    ignoreStructuralCounts: true,
    ignoreYears: true,
    requireProofForComparatives: true,
    requireProofForVagueMagnitude: true,
  },
  structure: {
    requiredFields: [
      'beweisbarer_ausgangspunkt',
      'bruch',
      'unerwarteter_befund',
      'mechanismus',
      'handlungsregel',
    ],
  },
  deterministic: {
    minTotalScore: 20, // von maximal 40
    hardFailOnCharacterLimit: true,
  },
  selfSimilarity: {
    minHistory: 10,
    maxSimilarity: 0.9,
    windowDays: 90,
  },
};

export type GateThresholdOverrides = {
  [K in keyof GateThresholds]?: Partial<GateThresholds[K]>;
};

export function resolveThresholds(overrides?: GateThresholdOverrides): GateThresholds {
  const base = DEFAULT_GATE_THRESHOLDS;
  if (!overrides) return base;
  return {
    proofBinding: { ...base.proofBinding, ...overrides.proofBinding },
    structure: { ...base.structure, ...overrides.structure },
    deterministic: { ...base.deterministic, ...overrides.deterministic },
    selfSimilarity: { ...base.selfSimilarity, ...overrides.selfSimilarity },
  };
}

// --- Belege ---------------------------------------------------------------

export interface GateProofAsset {
  id: string;
  type: string;
  content: string;
  /**
   * DSGVO (2A ergänzt die Spalte in Migration 016). `undefined` = Spalte noch
   * nicht migriert -> der Beleg zählt weiterhin, damit das Gate vor der
   * Migration nicht alles blockiert. Ein AUSDRÜCKLICH nicht erteiltes
   * Einverständnis zählt nie.
   */
  consentStatus?: string | null;
}

const CONSENT_OK = new Set(['granted', 'not_required', 'public', 'owner']);

/** Ohne Zustimmung kein Beleg — reine Funktion, damit sie einzeln testbar ist. */
export function isProofAssetEligible(asset: GateProofAsset): boolean {
  if (asset.consentStatus === undefined) return true; // Spalte fehlt noch (2A)
  if (asset.consentStatus === null) {
    // Kundenzitate brauchen eine ausdrückliche Grundlage; eigene Beobachtungen
    // und Metriken gehören dem Workspace selbst.
    return asset.type !== 'customer_quote';
  }
  return CONSENT_OK.has(asset.consentStatus);
}

// --- Behauptungs-Erkennung (Prüfung 1) ------------------------------------

export interface VerifiableClaim {
  /** Rohtext der Fundstelle. */
  text: string;
  /** Normalisierter Zahlenwert; null bei rein sprachlichen Vergleichen. */
  value: number | null;
  /**
   * `number`          — bezifferte Angabe ("31 %", "1.200 Nutzer")
   * `comparative`     — multiplikativer Vergleich ("doppelt", "halbiert")
   * `vague_magnitude` — unbezifferte Ergebnisbehauptung ("drastisch gesunken")
   */
  kind: 'number' | 'comparative' | 'vague_magnitude';
  start: number;
  end: number;
}

const STRUCTURAL_NOUNS = [
  'ding', 'dinge', 'schritt', 'schritte', 'regel', 'regeln', 'grund', 'gründe',
  'frage', 'fragen', 'punkt', 'punkte', 'teil', 'teile', 'weg', 'wege',
  'lektion', 'lektionen', 'satz', 'sätze', 'kapitel', 'ideen', 'idee',
  'things', 'steps', 'rules', 'reasons', 'questions', 'points', 'lessons', 'ways',
];

const COMPARATIVE_TERMS = [
  'doppelt', 'verdoppelt', 'verdreifacht', 'halbiert', 'dreifach', 'vierfach',
  'zehnfach', 'vervielfacht', 'doubled', 'tripled', 'halved', 'quadrupled',
];

/**
 * Vage Steigerungswörter. Allein sind sie KEINE Behauptung — "Ich sage das ganz
 * deutlich" ist ein Redeeinschub. Erst zusammen mit einem Veränderungsverb im
 * SELBEN SATZ entsteht daraus eine Ergebnisbehauptung ("drastisch gesunken"),
 * und §6.2 Prüfung 1 verlangt Belege für "Zahl, Ergebnis, Vergleich".
 *
 * Diese Sorte ist die unfalsifizierbarste von allen und genau der Satz, den ein
 * hochfrequentes KI-Konto in Serie produziert (§1).
 */
const VAGUE_MAGNITUDE_TERMS = [
  'drastisch', 'deutlich', 'massiv', 'erheblich', 'signifikant', 'spürbar', 'enorm',
  'dramatically', 'significantly', 'substantially', 'drastically', 'markedly', 'considerably',
];

/** Ohne eines dieser Wörter im selben Satz ist ein vages Wort nur ein Adverb. */
const CHANGE_TERMS = [
  'gesunken', 'gestiegen', 'gefallen', 'gewachsen', 'geschrumpft', 'verbessert',
  'verschlechtert', 'zurückgegangen', 'reduziert', 'erhöht', 'gesteigert',
  'zugenommen', 'abgenommen',
  'dropped', 'increased', 'improved', 'grew', 'reduced', 'declined', 'worsened', 'shrank',
];

/** "1.200" -> 1200, "3,5" -> 3.5 — deutsche und englische Schreibweise. */
export function normalizeNumericLiteral(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d/.test(trimmed)) return null;
  let normalized = trimmed;
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    // Die letzte Trennung ist das Dezimalzeichen.
    normalized =
      normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
  } else if (hasComma) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(normalized)
      ? normalized.replace(/,/g, '')
      : normalized.replace(',', '.');
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const NUMBER_PATTERN = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function urlRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index !== undefined) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function insideRange(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function isEnumerationMarker(text: string, start: number, raw: string): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const prefix = text.slice(lineStart, start);
  if (prefix.trim().length > 0) return false;
  const after = text.slice(start + raw.length, start + raw.length + 2);
  return /^[.)]\s?/.test(after);
}

function followsStructuralNoun(text: string, endIndex: number): boolean {
  const tail = text.slice(endIndex, endIndex + 24).toLowerCase();
  const word = /^\s+([\p{L}]+)/u.exec(tail)?.[1];
  return word !== undefined && STRUCTURAL_NOUNS.includes(word);
}

/**
 * Satzgrenzen um eine Fundstelle. Die Ko-Okkurrenz wird bewusst auf den Satz
 * begrenzt statt auf ein Zeichenfenster: "Ich sage es deutlich. Der Umsatz ist
 * gestiegen." darf keine Behauptung ergeben, obwohl beide Wörter nah beieinander
 * stehen.
 */
export function sentenceBoundsAt(text: string, index: number): [number, number] {
  const isBoundary = (char: string) => char === '.' || char === '!' || char === '?' || char === '\n';
  let start = 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (isBoundary(text[cursor])) {
      start = cursor + 1;
      break;
    }
  }
  let end = text.length;
  for (let cursor = index; cursor < text.length; cursor++) {
    if (isBoundary(text[cursor])) {
      end = cursor;
      break;
    }
  }
  return [start, end];
}

/** Wortgenauer Treffer — "Fellpflege" darf nicht als "fell" durchgehen. */
function findWholeWord(haystack: string, needle: string, from = 0): number {
  let cursor = from;
  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) return -1;
    const before = index === 0 ? ' ' : haystack[index - 1];
    const after = index + needle.length >= haystack.length ? ' ' : haystack[index + needle.length];
    if (!/[\p{L}]/u.test(before) && !/[\p{L}]/u.test(after)) return index;
    cursor = index + needle.length;
  }
}

/** Erstes Veränderungsverb im Satz — oder null, wenn keines vorkommt. */
function findChangeTerm(sentence: string): { term: string; start: number; end: number } | null {
  let best: { term: string; start: number; end: number } | null = null;
  for (const term of CHANGE_TERMS) {
    const index = findWholeWord(sentence, term);
    if (index === -1) continue;
    if (!best || index < best.start) best = { term, start: index, end: index + term.length };
  }
  return best;
}

/**
 * Findet überprüfbare Behauptungen — Zahl, Ergebnis, Vergleich — samt Span.
 * Rein und exportiert, damit der Negativfall ohne Datenbank testbar ist.
 */
export function extractVerifiableClaims(
  text: string,
  thresholds: GateThresholds['proofBinding'] = DEFAULT_GATE_THRESHOLDS.proofBinding
): VerifiableClaim[] {
  const claims: VerifiableClaim[] = [];
  const urls = urlRanges(text);

  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const start = match.index;
    if (start === undefined) continue;
    if (insideRange(urls, start)) continue;
    if (isEnumerationMarker(text, start, raw)) continue;

    const end = start + raw.length;
    const value = normalizeNumericLiteral(raw);
    if (value === null) continue;

    const unitMatch = /^\s*(%|€|\$|Prozent|percent|x|×|mal)/i.exec(text.slice(end, end + 10));
    const hasUnit = unitMatch !== null;

    if (thresholds.ignoreYears && !hasUnit && /^\d{4}$/.test(raw) && value >= 1900 && value <= 2100) {
      continue;
    }
    if (thresholds.ignoreStructuralCounts && !hasUnit && followsStructuralNoun(text, end)) {
      continue;
    }

    claims.push({
      text: hasUnit ? text.slice(start, end + unitMatch[0].length) : raw,
      value,
      kind: 'number',
      start,
      end: hasUnit ? end + unitMatch[0].length : end,
    });
  }

  if (thresholds.requireProofForComparatives) {
    const lowered = text.toLowerCase();
    for (const term of COMPARATIVE_TERMS) {
      let from = 0;
      for (;;) {
        const index = lowered.indexOf(term, from);
        if (index === -1) break;
        from = index + term.length;
        if (insideRange(urls, index)) continue;
        const before = index === 0 ? ' ' : lowered[index - 1];
        if (/[\p{L}]/u.test(before)) continue;
        // Vergleiche, die ohnehin an einer Zahl hängen, sind bereits erfasst.
        const overlaps = claims.some((claim) => Math.abs(claim.start - index) < 24);
        if (overlaps) continue;
        claims.push({
          text: text.slice(index, index + term.length),
          value: null,
          kind: 'comparative',
          start: index,
          end: index + term.length,
        });
      }
    }
  }

  if (thresholds.requireProofForVagueMagnitude) {
    const lowered = text.toLowerCase();
    const seen = new Set<string>();
    for (const term of VAGUE_MAGNITUDE_TERMS) {
      let from = 0;
      for (;;) {
        const index = findWholeWord(lowered, term, from);
        if (index === -1) break;
        from = index + term.length;
        if (insideRange(urls, index)) continue;

        // Ko-Okkurrenz-Bedingung: ohne Veränderungsverb im selben Satz ist
        // "deutlich" nur ein Adverb, keine Ergebnisbehauptung.
        const [sentenceStart, sentenceEnd] = sentenceBoundsAt(text, index);
        const sentence = lowered.slice(sentenceStart, sentenceEnd);
        const change = findChangeTerm(sentence);
        if (!change) continue;

        // Ein bezifferter Satz ist bereits quantifiziert — "um 31 % deutlich
        // gesunken" darf nicht ein zweites Mal beanstandet werden.
        const quantified = claims.some(
          (claim) =>
            claim.kind === 'number' && claim.start >= sentenceStart && claim.start < sentenceEnd
        );
        if (quantified) continue;

        const start = Math.min(index, sentenceStart + change.start);
        const end = Math.max(index + term.length, sentenceStart + change.end);
        const key = `${start}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);

        claims.push({
          text: text.slice(start, end),
          value: null,
          kind: 'vague_magnitude',
          start,
          end,
        });
      }
    }
  }

  return claims.sort((a, b) => a.start - b.start);
}

/** Alle Zahlenwerte, die in den zugelassenen Belegen tatsächlich vorkommen. */
export function proofNumericValues(assets: GateProofAsset[]): Set<number> {
  const values = new Set<number>();
  for (const asset of assets) {
    for (const match of asset.content.matchAll(NUMBER_PATTERN)) {
      const value = normalizeNumericLiteral(match[0]);
      if (value !== null) values.add(value);
    }
  }
  return values;
}

export function isClaimBound(claim: VerifiableClaim, assets: GateProofAsset[]): boolean {
  if (assets.length === 0) return false;
  if (claim.kind === 'comparative' || claim.kind === 'vague_magnitude') {
    // Sprachliche Behauptungen sind gebunden, wenn ein zugelassener Beleg
    // dieselbe Aussage trägt — Whitespace normalisiert, damit ein Zeilenumbruch
    // im Entwurf die Bindung nicht zerreißt.
    const needle = claim.text.toLowerCase().replace(/\s+/g, ' ').trim();
    return assets.some((asset) =>
      asset.content.toLowerCase().replace(/\s+/g, ' ').includes(needle)
    );
  }
  if (claim.value === null) return false;
  return proofNumericValues(assets).has(claim.value);
}

// --- Meldungen (UI-Sprache des Workspaces) --------------------------------

interface GateMessages {
  proof_ok: string;
  proof_no_evidence: string;
  proof_unbound: string;
  proof_vague_magnitude: string;
  structure_ok: string;
  structure_missing: string;
  structure_missing_finding: string;
  structure_none: string;
  deterministic_ok: string;
  deterministic_too_long: string;
  deterministic_low: string;
  similarity_ok: string;
  similarity_skipped_history: string;
  similarity_skipped_no_embeddings: string;
  similarity_failed: string;
}

const MESSAGES: Record<AppLocale, GateMessages> = {
  de: {
    proof_ok: 'Jede überprüfbare Angabe zeigt auf einen zugelassenen Beleg.',
    proof_no_evidence:
      'Der Entwurf enthält überprüfbare Angaben, aber es ist kein zugelassener Beleg hinterlegt. Lege einen Proof an oder nimm die Angabe heraus.',
    proof_unbound:
      '„{claim}" ist eine überprüfbare Angabe ohne Beleg. Unbelegte Zahlen werden nicht veröffentlicht.',
    proof_vague_magnitude:
      '„{claim}" behauptet ein Ergebnis, ohne es zu beziffern. Nenne die Zahl aus einem Beleg — oder streiche die Steigerung.',
    structure_ok: 'Der Entwurf erfüllt das Resonanz-Schema.',
    structure_missing:
      'Es fehlt: {fields}. Ohne unerwarteten Befund ist das ein generischer Post.',
    structure_missing_finding:
      'Ohne „unerwarteter Befund" ist der Post generisch — er sagt nichts, was der Leser nicht schon vermutet.',
    structure_none: 'Für diesen Entwurf ist kein Resonanz-Schema hinterlegt.',
    deterministic_ok: 'Formatierung und Plattform-Hygiene sind in Ordnung.',
    deterministic_too_long: 'Der Entwurf überschreitet das Zeichenlimit des Kanals um {over} Zeichen.',
    deterministic_low:
      'Formatierung/Hygiene erreichen nur {score} von {min} Punkten: {failed}.',
    similarity_ok: 'Der Entwurf hebt sich von deinen letzten {days} Tagen ab.',
    similarity_skipped_history:
      'Übersprungen: nur {count} von mindestens {min} eigenen Posts als Vergleich vorhanden. Diese Prüfung hat NICHT stattgefunden.',
    similarity_skipped_no_embeddings:
      'Übersprungen: kein Embedding-Anbieter konfiguriert. Diese Prüfung hat NICHT stattgefunden.',
    similarity_failed:
      'Zu ähnlich zu einem eigenen Post der letzten {days} Tage ({percent} % Übereinstimmung).',
  },
  en: {
    proof_ok: 'Every verifiable claim points to an eligible proof asset.',
    proof_no_evidence:
      'The draft makes verifiable claims but no eligible proof asset is attached. Add a proof or remove the claim.',
    proof_unbound:
      '"{claim}" is a verifiable claim without proof. Unbacked numbers are not published.',
    proof_vague_magnitude:
      '"{claim}" claims a result without quantifying it. Name the number from a proof asset — or drop the intensifier.',
    structure_ok: 'The draft satisfies the resonance schema.',
    structure_missing: 'Missing: {fields}. Without an unexpected finding this is a generic post.',
    structure_missing_finding:
      'Without an "unexpected finding" the post is generic — it says nothing the reader did not already assume.',
    structure_none: 'No resonance schema is attached to this draft.',
    deterministic_ok: 'Formatting and platform hygiene are fine.',
    deterministic_too_long: 'The draft exceeds the channel character limit by {over} characters.',
    deterministic_low: 'Formatting/hygiene only reach {score} of {min} points: {failed}.',
    similarity_ok: 'The draft stands apart from your last {days} days.',
    similarity_skipped_history:
      'Skipped: only {count} of at least {min} own posts available for comparison. This check did NOT run.',
    similarity_skipped_no_embeddings:
      'Skipped: no embedding provider configured. This check did NOT run.',
    similarity_failed:
      'Too similar to one of your own posts from the last {days} days ({percent}% match).',
  },
  es: {
    proof_ok: 'Cada afirmación verificable apunta a una prueba admitida.',
    proof_no_evidence:
      'El borrador contiene afirmaciones verificables pero no hay ninguna prueba admitida. Añade una prueba o elimina la afirmación.',
    proof_unbound:
      '«{claim}» es una afirmación verificable sin prueba. Las cifras sin respaldo no se publican.',
    proof_vague_magnitude:
      '«{claim}» afirma un resultado sin cuantificarlo. Indica la cifra de una prueba — o elimina el intensificador.',
    structure_ok: 'El borrador cumple el esquema de resonancia.',
    structure_missing: 'Falta: {fields}. Sin un hallazgo inesperado es un post genérico.',
    structure_missing_finding:
      'Sin «hallazgo inesperado» el post es genérico — no dice nada que el lector no supusiera ya.',
    structure_none: 'Este borrador no tiene esquema de resonancia.',
    deterministic_ok: 'El formato y la higiene de plataforma están bien.',
    deterministic_too_long: 'El borrador supera el límite de caracteres del canal en {over}.',
    deterministic_low: 'Formato/higiene solo alcanzan {score} de {min} puntos: {failed}.',
    similarity_ok: 'El borrador se distingue de tus últimos {days} días.',
    similarity_skipped_history:
      'Omitido: solo {count} de al menos {min} publicaciones propias disponibles. Esta comprobación NO se ejecutó.',
    similarity_skipped_no_embeddings:
      'Omitido: no hay proveedor de embeddings configurado. Esta comprobación NO se ejecutó.',
    similarity_failed:
      'Demasiado parecido a una publicación propia de los últimos {days} días ({percent} % de coincidencia).',
  },
};

function say(locale: AppLocale, key: keyof GateMessages, vars: Record<string, string | number> = {}): string {
  const template = MESSAGES[locale][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

const FIELD_LABELS: Record<AppLocale, Record<string, string>> = {
  de: {
    beweisbarer_ausgangspunkt: 'beweisbarer Ausgangspunkt',
    bruch: 'Bruch',
    unerwarteter_befund: 'unerwarteter Befund',
    mechanismus: 'Mechanismus',
    handlungsregel: 'Handlungsregel',
    reibungsfrage: 'Reibungsfrage',
  },
  en: {
    beweisbarer_ausgangspunkt: 'provable starting point',
    bruch: 'break',
    unerwarteter_befund: 'unexpected finding',
    mechanismus: 'mechanism',
    handlungsregel: 'rule of action',
    reibungsfrage: 'friction question',
  },
  es: {
    beweisbarer_ausgangspunkt: 'punto de partida demostrable',
    bruch: 'ruptura',
    unerwarteter_befund: 'hallazgo inesperado',
    mechanismus: 'mecanismo',
    handlungsregel: 'regla de acción',
    reibungsfrage: 'pregunta de fricción',
  },
};

// --- Die vier Prüfungen ---------------------------------------------------

function finding(
  check: GateCheck,
  status: GateFindingStatus,
  message: string,
  remedy: GateRemedy = null,
  span: GateFinding['span'] = null
): GateFinding {
  return { check, passed: status === 'passed', message, remedy, span, status };
}

export function checkProofBinding(input: {
  content: string;
  proofAssets: GateProofAsset[];
  locale?: AppLocale;
  thresholds?: GateThresholds;
}): GateFinding {
  const locale = input.locale ?? 'de';
  const thresholds = input.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const eligible = input.proofAssets.filter(isProofAssetEligible);
  const claims = extractVerifiableClaims(input.content, thresholds.proofBinding);

  if (claims.length === 0) {
    return finding('proof_binding', 'passed', say(locale, 'proof_ok'));
  }

  const unbound = claims.find((claim) => !isClaimBound(claim, eligible));
  if (!unbound) {
    return finding('proof_binding', 'passed', say(locale, 'proof_ok'));
  }

  // Die Meldung richtet sich nach dem FEHLERBILD, nicht nach dem Bestand:
  // eine unbezifferte Ergebnisbehauptung ist kein fehlender Beleg, sondern
  // eine fehlende Zahl. Sagte das Gate hier "leg einen Beleg an", legte der
  // Nutzer einen an, der die Aussage nie deckt — und wäre zu Recht verärgert.
  const messageKey: keyof GateMessages =
    unbound.kind === 'vague_magnitude'
      ? 'proof_vague_magnitude'
      : eligible.length === 0
        ? 'proof_no_evidence'
        : 'proof_unbound';

  return finding(
    'proof_binding',
    'failed',
    say(locale, messageKey, { claim: unbound.text.trim() }),
    'add_proof',
    { start: unbound.start, end: unbound.end }
  );
}

export function checkStructure(input: {
  structure: Record<string, unknown> | null | undefined;
  locale?: AppLocale;
  thresholds?: GateThresholds;
}): GateFinding {
  const locale = input.locale ?? 'de';
  const thresholds = input.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  if (!input.structure || typeof input.structure !== 'object') {
    return finding('structure', 'failed', say(locale, 'structure_none'), 'rewrite_structure');
  }
  const missing = thresholds.structure.requiredFields.filter((field) => {
    const value = (input.structure as Record<string, unknown>)[field];
    return typeof value !== 'string' || value.trim().length < 3;
  });
  if (missing.length === 0) {
    return finding('structure', 'passed', say(locale, 'structure_ok'));
  }
  const labels = missing.map((field) => FIELD_LABELS[locale][field] ?? field).join(', ');
  const message = missing.includes('unerwarteter_befund')
    ? `${say(locale, 'structure_missing', { fields: labels })} ${say(locale, 'structure_missing_finding')}`
    : say(locale, 'structure_missing', { fields: labels });
  return finding('structure', 'failed', message, 'rewrite_structure');
}

export function checkDeterministic(input: {
  content: string;
  platform: PlatformType;
  characterLimit?: number;
  locale?: AppLocale;
  thresholds?: GateThresholds;
}): GateFinding {
  const locale = input.locale ?? 'de';
  const thresholds = input.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const result = runDeterministicChecks(input.content, input.platform);
  const total = result.formatting_score + result.platform_hygiene_score;

  const limitCheck = result.checks.find((check) => check.id === 'character_limit');
  if (thresholds.deterministic.hardFailOnCharacterLimit && limitCheck && !limitCheck.passed) {
    // Ohne ausdrückliches Kanal-Limit gilt die Plattform-Regel — sonst zeigt
    // der Span ins Leere und die UI kann die Überlänge nicht markieren.
    const limit = input.characterLimit ?? getPlatformRules(input.platform).max_text_length;
    return finding(
      'deterministic',
      'failed',
      say(locale, 'deterministic_too_long', { over: Math.max(0, input.content.length - limit) }),
      'shorten',
      { start: Math.min(limit, input.content.length), end: input.content.length }
    );
  }

  if (total < thresholds.deterministic.minTotalScore) {
    const failed = result.checks.filter((check) => !check.passed).map((check) => check.id);
    const lengthish = failed.some((id) =>
      ['paragraph_length', 'sentence_length', 'character_limit'].includes(id)
    );
    return finding(
      'deterministic',
      'failed',
      say(locale, 'deterministic_low', {
        score: total,
        min: thresholds.deterministic.minTotalScore,
        failed: failed.join(', ') || '—',
      }),
      lengthish ? 'shorten' : 'rewrite_structure'
    );
  }

  return finding('deterministic', 'passed', say(locale, 'deterministic_ok'));
}

export interface SelfSimilarityContext {
  /** Wie viele eigene Posts im Fenster als Vergleich vorliegen. */
  historySize: number;
  /** Liefert das Embedding oder null, wenn kein Anbieter konfiguriert ist. */
  embed: (text: string) => Promise<number[] | null>;
  /** Nächste Nachbarn im eigenen Bestand. */
  findSimilar: (embedding: number[]) => Promise<Array<{ id: string; similarity: number }>>;
}

export async function checkSelfSimilarity(input: {
  content: string;
  context?: SelfSimilarityContext;
  locale?: AppLocale;
  thresholds?: GateThresholds;
}): Promise<GateFinding> {
  const locale = input.locale ?? 'de';
  const thresholds = input.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const { minHistory, maxSimilarity, windowDays } = thresholds.selfSimilarity;

  if (!input.context) {
    return finding('self_similarity', 'skipped', say(locale, 'similarity_skipped_no_embeddings'));
  }
  if (input.context.historySize < minHistory) {
    // §8: sichtbar übersprungen — niemals als "bestanden" gemeldet.
    return finding(
      'self_similarity',
      'skipped',
      say(locale, 'similarity_skipped_history', {
        count: input.context.historySize,
        min: minHistory,
      })
    );
  }

  const embedding = await input.context.embed(input.content);
  if (!embedding) {
    return finding('self_similarity', 'skipped', say(locale, 'similarity_skipped_no_embeddings'));
  }

  const neighbours = await input.context.findSimilar(embedding);
  const worst = neighbours
    .filter((entry) => entry.similarity >= maxSimilarity)
    .sort((a, b) => b.similarity - a.similarity)[0];
  if (worst) {
    return finding(
      'self_similarity',
      'failed',
      say(locale, 'similarity_failed', {
        days: windowDays,
        percent: Math.round(worst.similarity * 100),
      }),
      'differentiate'
    );
  }
  return finding('self_similarity', 'passed', say(locale, 'similarity_ok', { days: windowDays }));
}

// --- Der Gate-Lauf --------------------------------------------------------

export interface GateInput {
  content: string;
  platform: PlatformType;
  characterLimit?: number;
  structure: Record<string, unknown> | null | undefined;
  /** Belege aus Signal.evidence (Vertrag C3), bereits aufgelöst. */
  proofAssets: GateProofAsset[];
  selfSimilarity?: SelfSimilarityContext;
  locale?: AppLocale;
  thresholds?: GateThresholdOverrides;
  /** Nur setzen, wenn tatsächlich protokolliert übersteuert wurde. */
  overriddenBy?: string | null;
  narrative?: NarrativeGateContext;
}

/**
 * Vier Prüfungen in fester Reihenfolge, Abbruch bei Nichtbestehen. Die
 * Reihenfolge ist kein Zufall: die härteste und billigste Prüfung zuerst,
 * die einzige, die Netzwerk kostet, zuletzt.
 */
export async function runQualityGate(input: GateInput): Promise<GateResult> {
  const thresholds = resolveThresholds(input.thresholds);
  const locale = input.locale ?? 'de';
  const findings: GateFinding[] = [];

  const factProofs: GateProofAsset[] = (input.narrative?.facts ?? []).map((fact) => ({
    id: fact.id,
    type: fact.factKind,
    content: 'number' in fact.value
      ? `${fact.value.number}${fact.unit ? ` ${fact.unit}` : ''}`
      : 'text' in fact.value ? fact.value.text : String(fact.value.boolean),
  }));
  const proof = checkProofBinding({
    content: input.content,
    proofAssets: [...input.proofAssets, ...factProofs],
    locale,
    thresholds,
  });
  findings.push(proof);
  if (proof.status === 'failed') return conclude(findings, input.overriddenBy ?? null);

  let requiredCheckSkipped = false;
  if (input.narrative) {
    const narrative = await runNarrativeChecks(input.content, input.narrative);
    findings.push(...narrative.findings);
    requiredCheckSkipped = narrative.requiredCheckSkipped;
    if (narrative.findings.some((entry) => entry.status === 'failed')) {
      return conclude(findings, input.overriddenBy ?? null, requiredCheckSkipped);
    }
  }

  const structure = checkStructure({ structure: input.structure, locale, thresholds });
  findings.push(structure);
  if (structure.status === 'failed') return conclude(findings, input.overriddenBy ?? null);

  const deterministic = checkDeterministic({
    content: input.content,
    platform: input.platform,
    characterLimit: input.characterLimit,
    locale,
    thresholds,
  });
  findings.push(deterministic);
  if (deterministic.status === 'failed') return conclude(findings, input.overriddenBy ?? null);

  const similarity = await checkSelfSimilarity({
    content: input.content,
    context: input.selfSimilarity,
    locale,
    thresholds,
  });
  findings.push(similarity);

  return conclude(findings, input.overriddenBy ?? null, requiredCheckSkipped);
}

function conclude(
  findings: GateFinding[],
  overriddenBy: string | null,
  requiredCheckSkipped = false
): GateResult {
  const blocked = findings.some((entry) => entry.status === 'failed');
  return {
    // Übersteuern ist nur mit protokolliertem Verursacher möglich (D1).
    passed: (!blocked && !requiredCheckSkipped) || Boolean(overriddenBy),
    findings,
    overriddenBy,
  };
}

// --- Gate-Statistik fürs Cockpit ------------------------------------------

export interface GateStats {
  evaluated: number;
  passed: number;
  blocked: number;
  overridden: number;
  /** Wie oft welche Prüfung blockiert hat — zeigt eine zu enge Schwelle sofort. */
  blockedBy: Record<GateCheck, number>;
  skipped: Record<GateCheck, number>;
}

export function summarizeGateResults(results: GateResult[]): GateStats {
  const blockedBy: Record<GateCheck, number> = {
    proof_binding: 0,
    language: 0,
    mention: 0,
    sample_copy: 0,
    narrative_consistency: 0,
    structure: 0,
    deterministic: 0,
    self_similarity: 0,
  };
  const skipped: Record<GateCheck, number> = {
    proof_binding: 0,
    language: 0,
    mention: 0,
    sample_copy: 0,
    narrative_consistency: 0,
    structure: 0,
    deterministic: 0,
    self_similarity: 0,
  };
  let passed = 0;
  let blocked = 0;
  let overridden = 0;

  for (const result of results) {
    const failing = result.findings.filter((entry) => entry.status === 'failed');
    for (const entry of failing) blockedBy[entry.check] += 1;
    for (const entry of result.findings) {
      if (entry.status === 'skipped') skipped[entry.check] += 1;
    }
    if (result.overriddenBy) overridden += 1;
    if (failing.length > 0) blocked += 1;
    else passed += 1;
  }

  return { evaluated: results.length, passed, blocked, overridden, blockedBy, skipped };
}

/** Für die Persistenz in content_item_variants.gate_result (JSONB). */
export function gateResultToJson(result: GateResult): Record<string, unknown> {
  return {
    passed: result.passed,
    overriddenBy: result.overriddenBy,
    findings: result.findings.map((entry) => ({
      check: entry.check,
      passed: entry.passed,
      status: entry.status,
      message: entry.message,
      remedy: entry.remedy,
      span: entry.span,
    })),
  };
}
