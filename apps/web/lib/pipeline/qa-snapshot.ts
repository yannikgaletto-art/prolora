import { sha256Hex } from '@/lib/writer/hash';

export const NARRATIVE_GATE_VERSION = 'narrative-gate-v1' as const;

export interface QaSnapshotInput {
  content: string;
  factsHash: string;
  sampleHash: string;
  language: 'de' | 'en';
  mentionDecision: 'include' | 'omit';
  gateVersion: string;
}

export interface QaSnapshot extends Omit<QaSnapshotInput, 'content'> {
  contentHash: string;
  gatePassed: boolean;
  checkedAt: string;
}

export function createQaSnapshot(input: QaSnapshotInput & { gatePassed: boolean }): QaSnapshot {
  return {
    contentHash: sha256Hex(input.content),
    factsHash: input.factsHash,
    sampleHash: input.sampleHash,
    language: input.language,
    mentionDecision: input.mentionDecision,
    gateVersion: input.gateVersion,
    gatePassed: input.gatePassed,
    checkedAt: new Date().toISOString(),
  };
}

export type QaFreshnessReason =
  | 'gate_not_passed'
  | 'content_changed'
  | 'facts_changed'
  | 'samples_changed'
  | 'language_changed'
  | 'mention_changed'
  | 'gate_changed';

export function verifyQaFreshness(
  snapshot: QaSnapshot,
  current: QaSnapshotInput
): { fresh: boolean; reasons: QaFreshnessReason[] } {
  const reasons: QaFreshnessReason[] = [];
  if (!snapshot.gatePassed) reasons.push('gate_not_passed');
  if (snapshot.contentHash !== sha256Hex(current.content)) reasons.push('content_changed');
  if (snapshot.factsHash !== current.factsHash) reasons.push('facts_changed');
  if (snapshot.sampleHash !== current.sampleHash) reasons.push('samples_changed');
  if (snapshot.language !== current.language) reasons.push('language_changed');
  if (snapshot.mentionDecision !== current.mentionDecision) reasons.push('mention_changed');
  if (snapshot.gateVersion !== current.gateVersion) reasons.push('gate_changed');
  return { fresh: reasons.length === 0, reasons };
}
