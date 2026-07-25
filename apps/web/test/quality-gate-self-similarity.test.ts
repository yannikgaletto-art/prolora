// Failure Mode §8: "Selbstähnlichkeits-Prüfung ohne Historie blockiert die
// ersten Posts" -> unter 10 eigenen Posts wird Prüfung 4 ÜBERSPRUNGEN.
//
// Der Kern dieses Tests: übersprungen ist NICHT bestanden. Würde ein
// übersprungener Test als "bestanden" gemeldet, läse sich "wir haben keine
// Vergleichsbasis" wie ein Qualitätsnachweis — genau die Sorte stiller
// Selbsttäuschung, gegen die das ganze Gate gebaut ist.
import { describe, expect, test, vi } from 'vitest';
import {
  checkSelfSimilarity,
  runQualityGate,
  summarizeGateResults,
  type SelfSimilarityContext,
} from '@/lib/pipeline/quality-gate';

const STRUCTURE = {
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

function context(historySize: number, similarity = 0): SelfSimilarityContext {
  return {
    historySize,
    embed: vi.fn(async () => new Array(1536).fill(0.1)),
    findSimilar: vi.fn(async () => (similarity > 0 ? [{ id: 'v-old', similarity }] : [])),
  };
}

describe('Prüfung 4 ohne ausreichende Historie', () => {
  test('unter 10 eigenen Posts wird die Prüfung als ÜBERSPRUNGEN gemeldet, nicht als bestanden', async () => {
    const finding = await checkSelfSimilarity({
      content: CLEAN_DRAFT,
      context: context(4),
    });

    expect(finding.status).toBe('skipped');
    // Die entscheidende Zusicherung: sie hat NICHT bestanden.
    expect(finding.passed).toBe(false);
    expect(finding.message.toLowerCase()).toContain('übersprungen');
    expect(finding.message).toContain('4');
    expect(finding.message).toContain('10');
    expect(finding.remedy).toBeNull();
  });

  test('eine übersprungene Prüfung 4 blockiert den Entwurf NICHT', async () => {
    const result = await runQualityGate({
      content: CLEAN_DRAFT,
      platform: 'linkedin',
      structure: STRUCTURE,
      proofAssets: [],
      selfSimilarity: context(4),
    });

    expect(result.passed).toBe(true);
    const similarity = result.findings.find((entry) => entry.check === 'self_similarity');
    expect(similarity?.status).toBe('skipped');
    expect(similarity?.passed).toBe(false);
  });

  test('das Embedding wird gar nicht erst erzeugt, wenn übersprungen wird', async () => {
    const ctx = context(2);
    await checkSelfSimilarity({ content: CLEAN_DRAFT, context: ctx });
    expect(ctx.embed).not.toHaveBeenCalled();
  });

  test('ohne Embedding-Anbieter wird ebenfalls übersprungen statt bestanden', async () => {
    const finding = await checkSelfSimilarity({
      content: CLEAN_DRAFT,
      context: {
        historySize: 50,
        embed: async () => null,
        findSimilar: async () => [],
      },
    });
    expect(finding.status).toBe('skipped');
    expect(finding.passed).toBe(false);
  });

  test('ganz ohne Kontext (RPC fehlt) wird übersprungen, nicht bestanden', async () => {
    const finding = await checkSelfSimilarity({ content: CLEAN_DRAFT });
    expect(finding.status).toBe('skipped');
    expect(finding.passed).toBe(false);
  });
});

describe('Prüfung 4 mit ausreichender Historie', () => {
  test('zu ähnlicher Entwurf wird blockiert', async () => {
    const finding = await checkSelfSimilarity({
      content: CLEAN_DRAFT,
      context: context(30, 0.97),
    });
    expect(finding.status).toBe('failed');
    expect(finding.remedy).toBe('differentiate');
    expect(finding.message).toContain('97');
  });

  test('ausreichend unterschiedlicher Entwurf besteht', async () => {
    const finding = await checkSelfSimilarity({
      content: CLEAN_DRAFT,
      context: context(30, 0.42),
    });
    expect(finding.status).toBe('passed');
    expect(finding.passed).toBe(true);
  });
});

describe('Gate-Statistik trennt übersprungen von bestanden', () => {
  test('übersprungene Prüfungen erscheinen als skipped, nicht als passed', async () => {
    const result = await runQualityGate({
      content: CLEAN_DRAFT,
      platform: 'linkedin',
      structure: STRUCTURE,
      proofAssets: [],
      selfSimilarity: context(3),
    });
    const stats = summarizeGateResults([result]);
    expect(stats.skipped.self_similarity).toBe(1);
    expect(stats.blockedBy.self_similarity).toBe(0);
    // Der Entwurf gilt als bestanden — die PRÜFUNG jedoch nicht.
    expect(stats.passed).toBe(1);
  });
});
