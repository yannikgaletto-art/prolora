// Reine Darstellungslogik des Tages-Cockpits (Plan 2 / 2B.5) — nach dem
// Repo-Muster von impact-card-logic.ts / media-card-logic.ts: alles, was ohne
// DOM entscheidbar ist, lebt in einer testbaren Datei neben der Komponente.
import type { BadgeTone } from '@/app/components/Badge';
import type { GateFinding } from '@/lib/pipeline/quality-gate';
import type { ContentItemEvidence, ContentItemState } from '@/lib/pipeline/state';
import type { PipelineCopy } from './copy';

export interface MarkedText {
  before: string;
  marked: string;
  after: string;
}

/**
 * Zerlegt den Text an der Fundstelle aus `GateFinding.span`, damit die UI
 * genau die Stelle markieren kann, die blockiert — statt „irgendwo im Text
 * ist eine unbelegte Zahl".
 */
export function splitBySpan(text: string, span: GateFinding['span']): MarkedText {
  if (!span) return { before: text, marked: '', after: '' };
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  if (end === start) return { before: text, marked: '', after: '' };
  return {
    before: text.slice(0, start),
    marked: text.slice(start, end),
    after: text.slice(end),
  };
}

/**
 * „Aus 23 Feedbacks → Proof: 2 Belege → 1 Muster" — die Herkunfts-Kette, die
 * in der UI sichtbar sein muss. Ohne sie ist ein generierter Post eine
 * Behauptung des Systems über sich selbst.
 */
export function provenanceChain(
  evidence: ContentItemEvidence,
  copy: Pick<PipelineCopy, 'evidence'>
): string[] {
  const chain: string[] = [];
  if (evidence.feedbackItemIds.length > 0) {
    chain.push(`${evidence.feedbackItemIds.length} ${copy.evidence.feedback}`);
  }
  if (evidence.proofAssetIds.length > 0) {
    chain.push(`${evidence.proofAssetIds.length} ${copy.evidence.proof}`);
  }
  if (evidence.communityIds.length > 0) {
    chain.push(`${evidence.communityIds.length} ${copy.evidence.community}`);
  }
  if (evidence.referenceIds.length > 0) {
    chain.push(`${evidence.referenceIds.length} ${copy.evidence.reference}`);
  }
  return chain;
}

/** Reichweiten-Ampel: warnt BEVOR die Kadenz einbricht, nicht danach (§8). */
export function coverageTone(days: number | null): BadgeTone {
  if (days === null) return 'gray';
  if (days < 3) return 'red';
  if (days < 7) return 'amber';
  return 'green';
}

export const STATE_TONES: Record<ContentItemState, BadgeTone> = {
  signal: 'gray',
  angled: 'gray',
  concepted: 'blue',
  drafted: 'amber',
  gated: 'teal',
  awaiting_approval: 'amber',
  scheduled: 'amber',
  published: 'green',
  measured: 'green',
  rejected: 'red',
};

export function findingTone(finding: GateFinding): BadgeTone {
  if (finding.status === 'failed') return 'red';
  // Übersprungen ist ausdrücklich NICHT grün — sonst liest sich "keine
  // Historie" wie ein bestandener Test.
  if (finding.status === 'skipped') return 'gray';
  return 'green';
}

/** Die eine Reparatur, die als Erstes ansteht — oder null. */
export function primaryRemedy(findings: GateFinding[]): GateFinding | null {
  return findings.find((entry) => entry.status === 'failed' && entry.remedy !== null) ?? null;
}
