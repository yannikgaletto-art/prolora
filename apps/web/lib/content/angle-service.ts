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

function newestProof(proofAssets: ProofAsset[], types: ProofAsset['type'][]): ProofAsset | null {
  return proofAssets.find((asset) => types.includes(asset.type)) ?? proofAssets[0] ?? null;
}

function shorten(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function suggestAngles(input: {
  goal: ContentGoal;
  productDescription: string | null;
  coreValue: string[];
  proofAssets: ProofAsset[];
  references: ContentReferenceRow[];
}): AngleSuggestion[] {
  const { goal, productDescription, coreValue, proofAssets, references } = input;
  const keywords = [
    ...coreValue,
    ...(productDescription ? productDescription.split(/\s+/).slice(0, 12) : []),
  ];
  const matched = matchReferences(references, goal, keywords, 6).map((m) => m.reference);

  const evidenceProof = newestProof(proofAssets, ['metric', 'experiment', 'case_study']);
  const founderProof = newestProof(proofAssets, ['founder_observation']);
  const quoteProof = newestProof(proofAssets, ['customer_quote']);

  const evidenceRef = pickForLens('evidence', matched);
  const founderRef = pickForLens('founder', matched);
  const communityRef = pickForLens('community', matched);

  const angles: AngleSuggestion[] = [
    {
      lens: 'evidence',
      title: evidenceProof
        ? `Deine Zahl als Story: ${shorten(evidenceProof.content, 60)}`
        : 'Deine stärkste Beobachtung als Analyse-Post',
      angle: evidenceProof
        ? `Erzähle, was hinter „${shorten(evidenceProof.content, 100)}" steckt: Annahme → überraschender Befund → harte Regel für die Leser.`
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
        ? `Founder-Einblick: ${shorten(founderProof.content, 60)}`
        : 'Eine echte Entscheidung beim Bauen — und was sie gekostet hat',
      angle: founderProof
        ? `Mach aus „${shorten(founderProof.content, 100)}" eine Strategiewechsel-Story: alte Annahme → Reibung → neue Entscheidung → Prinzip.`
        : 'Erzähle eine Entscheidung, einen Fehler oder einen Kurswechsel aus dem Produkt-Alltag — Prinzip statt Erfolgsmeldung.',
      structure_label: LENS_STRUCTURE_LABEL.founder,
      why_this_fits:
        'Ehrliche Founder-Entscheidungen mit gemischtem Ergebnis erzeugen laut Seed-Research mehr Diskussion als Erfolgsposts.',
      reference_id: founderRef?.id ?? null,
    },
    {
      lens: 'community',
      title: 'Die unbequeme Position, die deine Zielgruppe diskutieren will',
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
