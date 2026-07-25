// Prüfungen 2 und 3 des Gates (Plan 2 / 2B.2) plus die Reihenfolge-Zusicherung.
//
// Prüfung 2 setzt das Resonanz-Schema aus Migration 013 durch: fehlt der
// unerwartete Befund, ist der Post generisch — und ein generischer Post bei
// 3 Posts/Tag ist dieselbe Glaubwürdigkeitsfrage wie eine erfundene Zahl.
// Prüfung 3 nutzt lib/scoring/deterministic.ts wieder, aber mit SCHWELLE
// statt bloßer Punktzahl: ohne Schwelle hätte eine Punktzahl keine Wirkung.
import { describe, expect, test } from 'vitest';
import {
  checkDeterministic,
  checkStructure,
  DEFAULT_GATE_THRESHOLDS,
  resolveThresholds,
  RESONANCE_FIELDS,
  runQualityGate,
} from '@/lib/pipeline/quality-gate';

const FULL_STRUCTURE = {
  beweisbarer_ausgangspunkt: 'Sechs Wochen Support-Tickets ausgewertet.',
  bruch: 'Die Doku war nicht das Problem.',
  unerwarteter_befund: 'Fast alle Tickets kamen aus einem Dialogschritt.',
  mechanismus: 'Wer dort abbricht, sieht die Doku nie.',
  handlungsregel: 'Erst den Abbruchpunkt messen, dann schreiben.',
  reibungsfrage: 'Wo bricht dein Onboarding wirklich ab?',
};

const CLEAN_DRAFT = [
  'Wir haben sechs Wochen lang jedes Ticket gelesen.',
  '',
  'Die Doku war nicht das Problem.',
  '',
  'Fast alles kam aus einem einzigen Dialogschritt.',
  '',
  'Miss zuerst den Abbruch. Schreib die Doku danach.',
].join('\n');

describe('Prüfung 2 — Resonanz-Schema aus Migration 013', () => {
  test('das vollständige Schema besteht', () => {
    expect(checkStructure({ structure: FULL_STRUCTURE }).status).toBe('passed');
  });

  test('fehlender unerwarteter Befund blockiert und sagt warum', () => {
    const { unerwarteter_befund: _omitted, ...withoutFinding } = FULL_STRUCTURE;
    const result = checkStructure({ structure: withoutFinding });
    expect(result.status).toBe('failed');
    expect(result.remedy).toBe('rewrite_structure');
    expect(result.message).toMatch(/generisch/i);
  });

  test('ein leeres Feld zählt wie ein fehlendes', () => {
    expect(
      checkStructure({ structure: { ...FULL_STRUCTURE, mechanismus: '  ' } }).status
    ).toBe('failed');
  });

  test('gar kein Schema blockiert', () => {
    expect(checkStructure({ structure: null }).status).toBe('failed');
  });

  test('die Reibungsfrage ist bewusst optional', () => {
    const { reibungsfrage: _omitted, ...withoutQuestion } = FULL_STRUCTURE;
    expect(checkStructure({ structure: withoutQuestion }).status).toBe('passed');
    expect(DEFAULT_GATE_THRESHOLDS.structure.requiredFields).not.toContain('reibungsfrage');
    // Sie gehört trotzdem zum Schema — das Modell soll sie liefern.
    expect(RESONANCE_FIELDS).toContain('reibungsfrage');
  });

  test('die Pflichtfelder sind konfigurierbar', () => {
    const strict = resolveThresholds({ structure: { requiredFields: [...RESONANCE_FIELDS] } });
    const { reibungsfrage: _omitted, ...withoutQuestion } = FULL_STRUCTURE;
    expect(checkStructure({ structure: withoutQuestion, thresholds: strict }).status).toBe('failed');
  });
});

describe('Prüfung 3 — deterministisch, mit Schwelle', () => {
  test('ein sauberer Entwurf besteht', () => {
    expect(checkDeterministic({ content: CLEAN_DRAFT, platform: 'linkedin' }).status).toBe('passed');
  });

  test('Überlänge blockiert hart und markiert den überschüssigen Teil', () => {
    const tooLong = 'Ein Satz. '.repeat(60); // > 280 Zeichen für X
    const result = checkDeterministic({ content: tooLong, platform: 'x' });
    expect(result.status).toBe('failed');
    expect(result.remedy).toBe('shorten');
    expect(result.span).not.toBeNull();
    expect(result.span?.start).toBe(280);
    expect(result.span?.end).toBe(tooLong.length);
  });

  test('die Schwelle ist konfigurierbar — sonst wäre sie eine Punktzahl ohne Wirkung', () => {
    const wall = 'Dies ist ein sehr langer Absatz ohne jede Leerzeile, der bewusst gegen die Formatierungsregeln verstößt und in einem Stück durchläuft, damit die deterministische Prüfung ihn beanstandet. '.repeat(3);
    const lenient = checkDeterministic({
      content: wall,
      platform: 'linkedin',
      thresholds: resolveThresholds({ deterministic: { minTotalScore: 0 } }),
    });
    const strict = checkDeterministic({
      content: wall,
      platform: 'linkedin',
      thresholds: resolveThresholds({ deterministic: { minTotalScore: 40 } }),
    });
    expect(lenient.status).toBe('passed');
    expect(strict.status).toBe('failed');
  });
});

describe('Reihenfolge und Abbruch', () => {
  test('die Prüfungen laufen in der Reihenfolge 1→2→3→4', async () => {
    const result = await runQualityGate({
      content: CLEAN_DRAFT,
      platform: 'linkedin',
      structure: FULL_STRUCTURE,
      proofAssets: [],
    });
    expect(result.findings.map((entry) => entry.check)).toEqual([
      'proof_binding',
      'structure',
      'deterministic',
      'self_similarity',
    ]);
  });

  test('nach dem ersten Nichtbestehen wird abgebrochen — Prüfung 3 kostet dann nichts mehr', async () => {
    const result = await runQualityGate({
      content: CLEAN_DRAFT,
      platform: 'linkedin',
      structure: { bruch: 'nur eins' },
      proofAssets: [],
    });
    expect(result.passed).toBe(false);
    expect(result.findings.map((entry) => entry.check)).toEqual(['proof_binding', 'structure']);
  });
});
