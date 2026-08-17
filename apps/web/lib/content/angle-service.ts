// "Prolora empfiehlt heute" (GOAL-RUN9 §8 T2.2). Deterministic — no LLM call,
// 0 credits (D7): angle cards are assembled from matched patterns + the
// freshest proof assets. Pure functions, fully unit-testable.
import type { AngleSuggestion, ConceptLens, ContentGoal, ProofAsset } from '@prolora/shared';
import type { ContentReferenceRow } from '@/lib/db';
import { matchReferences } from '@/lib/content/reference-matcher';

// D5: one card per mandatory lens. Each lens prefers different pattern types.
const LENS_TYPES: Record<ConceptLens, ContentReferenceRow['reference_type'][]> = {
  evidence: ['data_analysis', 'framework', 'case_study'],
  founder: ['strategy_change', 'founder_story', 'mistake_to_learning'],
  community: ['contrarian_take', 'mistake_to_learning'],
};

const LENS_STRUCTURE_LABEL: Record<ConceptLens, string> = {
  evidence: 'Analyse-Post',
  founder: 'Strategiewechsel-Post',
  community: 'Anti-Intuition-Post',
};

function pickForLens(
  lens: ConceptLens,
  matched: ContentReferenceRow[]
): ContentReferenceRow | null {
  const wanted = new Set(LENS_TYPES[lens]);
  return matched.find((reference) => wanted.has(reference.reference_type)) ?? matched[0] ?? null;
}

/**
 * Exclusive material pull (RUN11-Feedback 17.08.): jede Linse VERBRAUCHT ihr
 * Material. Der alte `?? proofAssets[0]`-Fallback ließ bei nur einem Asset
 * alle drei Karten mit demselben Satz beginnen — genau das darf nie wieder
 * passieren. Lieber eine Karte ohne Beleg als drei gleiche.
 */
function takeProof(pool: ProofAsset[], types: ProofAsset['type'][]): ProofAsset | null {
  let index = pool.findIndex((asset) => types.includes(asset.type));
  if (index === -1 && pool.length > 0) index = 0;
  if (index === -1) return null;
  const [taken] = pool.splice(index, 1);
  return taken;
}

function shorten(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Beleg-Text → Hook-Zeile: Punkt statt Semantik-Prosa, Spannung am Ende. */
function asHook(claim: string, tension: string): string {
  const base = shorten(claim, 110).replace(/[.。!?]+$/u, '');
  return `${base}. ${tension}`;
}

export function suggestAngles(input: {
  goal: ContentGoal;
  productDescription: string | null;
  coreValue: string[];
  proofAssets: ProofAsset[];
  references: ContentReferenceRow[];
  founderPerspective?: string | null;
}): AngleSuggestion[] {
  const { goal, productDescription, coreValue, proofAssets, references } = input;
  const keywords = [
    ...coreValue,
    ...(productDescription ? productDescription.split(/\s+/).slice(0, 12) : []),
  ];
  const matched = matchReferences(references, goal, keywords, 6).map((m) => m.reference);

  // Reihenfolge = Prioritität: Evidence bekommt den besten Beleg, Founder und
  // Community ziehen aus dem Rest — nie zweimal dasselbe Material.
  const pool = [...proofAssets];
  const evidenceProof = takeProof(pool, ['metric', 'experiment', 'case_study']);
  const founderProof = takeProof(pool, ['founder_observation']);
  const quoteProof = takeProof(pool, ['customer_quote']);
  const founderPerspective = input.founderPerspective?.trim() || null;

  const evidenceRef = pickForLens('evidence', matched);
  const founderRef = pickForLens('founder', matched);
  const communityRef = pickForLens('community', matched);

  // Titel = die Punchline, wie sie im Feed stehen könnte — keine Meta-Prosa.
  // Die `angle`-Anweisung bleibt das Briefing für die Generierung (unsichtbar
  // auf der Karte, aber im prepare-Call wirksam).
  const angles: AngleSuggestion[] = [
    {
      lens: 'evidence',
      title: evidenceProof
        ? asHook(evidenceProof.content, 'Die meisten glauben mir das erst nach dem zweiten Satz.')
        : 'Die Zahl aus deiner Arbeit, die keiner erwartet — als Story.',
      angle: evidenceProof
        ? `Erzähle die Geschichte hinter „${shorten(evidenceProof.content, 100)}": Annahme → überraschender Befund → harte Regel für die Leser.`
        : 'Nimm eine echte Beobachtung aus deiner Arbeit und führe sie zum unerwarteten Befund — Zahlen schlagen Behauptungen.',
      structure_label: LENS_STRUCTURE_LABEL.evidence,
      why_this_fits: evidenceProof
        ? 'Ein selbst erhobener Beleg + kontraintuitiver Befund ist das resonanzstärkste Muster im Seed-Research.'
        : 'Ohne hinterlegten Beleg formuliert Prolora ehrlich als Beobachtung/Hypothese — trage einen ProofAsset ein, um es schärfer zu machen.',
      reference_id: evidenceRef?.id ?? null,
    },
    {
      lens: 'founder',
      title: founderProof
        ? asHook(founderProof.content, 'Diese Entscheidung hätte ich fast zu spät getroffen.')
        : founderPerspective
          ? asHook(founderPerspective, 'Warum ich trotzdem so baue — ehrlich erzählt.')
          : 'Der Moment, in dem ich meine eigene Annahme über Bord geworfen habe.',
      angle: founderProof
        ? `Mach aus „${shorten(founderProof.content, 100)}" eine Strategiewechsel-Story: alte Annahme → Reibung → neue Entscheidung → Prinzip.`
        : founderPerspective
          ? `Erzähle die Founder-Sicht hinter „${shorten(founderPerspective, 100)}": Entscheidung, Reibung, gemischtes Ergebnis, Prinzip.`
          : 'Erzähle eine Entscheidung, einen Fehler oder einen Kurswechsel aus dem Produkt-Alltag — Prinzip statt Erfolgsmeldung.',
      structure_label: LENS_STRUCTURE_LABEL.founder,
      why_this_fits:
        'Ehrliche Founder-Entscheidungen mit gemischtem Ergebnis erzeugen laut Seed-Research mehr Diskussion als Erfolgsposts.',
      reference_id: founderRef?.id ?? null,
    },
    {
      lens: 'community',
      title: quoteProof
        ? asHook(`„${shorten(quoteProof.content, 90)}"`, 'Ich halte den üblichen Ratschlag dazu für falsch.')
        : coreValue[0]
          ? asHook(`Unbequeme These: ${shorten(coreValue[0], 90)}`, 'Widerspruch ausdrücklich erwünscht.')
          : 'Der Standard-Ratschlag deiner Nische ist bequem — und falsch.',
      angle: quoteProof
        ? `Starte von „${shorten(quoteProof.content, 100)}" und vertrete die Gegenposition zum üblichen Ratschlag — mit Beleg, offen für Widerspruch.`
        : coreValue[0]
          ? `These: Die meisten optimieren an der falschen Stelle — dein Value „${shorten(coreValue[0], 80)}" setzt früher an. Lade explizit zu Gegenargumenten ein.`
          : 'Formuliere eine belegbare Gegenposition zum Standard-Ratschlag deiner Nische und lade explizit zu Widerspruch ein.',
      structure_label: LENS_STRUCTURE_LABEL.community,
      why_this_fits:
        'Kontraintuitive, belegte Positionen sind das Muster mit der höchsten Kommentar-Wahrscheinlichkeit (T3-Research).',
      reference_id: communityRef?.id ?? null,
    },
  ];

  return angles;
}
