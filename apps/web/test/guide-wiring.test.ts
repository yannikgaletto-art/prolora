// Verdrahtungstest im Hausmuster von `writer-ui.test.ts`: das Testsetup läuft
// ohne DOM, also wird die Quelle gelesen statt gerendert.
//
// GOAL-RUN11 hat die Richtung umgedreht: die GuideBar ("Schritt x von 6") war
// ein drittes Navigationssystem und ist bewusst aus Layout und Shell entfernt
// (D4 — Voraussetzungen fragt der One-Path-Posten-Button just-in-time ab).
// Dieser Test friert die ENTFERNUNG ein, damit die Leiste nicht durch einen
// Merge oder ein Refactoring stillschweigend zurückkommt. `lib/guide/` selbst
// bleibt liegen (D3) — die Locale-Tests unten sichern es weiter ab.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { APP_LOCALES } from '@/lib/i18n';
import { getGuideCopy, formatStepOf } from '@/lib/i18n/guide';
import { resolveGuide, type GuideStepId } from '@/lib/guide/steps';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

const layout = source('app/(dashboard)/layout.tsx');
const appShell = source('app/components/AppShell.tsx');

describe('GuideBar bleibt ausgebaut (GOAL-RUN11 D4)', () => {
  test('das Dashboard-Layout lädt den Faden nicht mehr', () => {
    expect(layout).not.toContain('loadGuideState');
    expect(layout).not.toContain('resolveGuide');
    expect(layout).not.toContain('getGuideCopy');
  });

  test('die Shell rendert keine Leiste mehr', () => {
    // Nur Import und JSX zählen — der Erklär-Kommentar darf sie nennen.
    expect(appShell).not.toContain('<GuideBar');
    expect(appShell).not.toMatch(/import\s+\{[^}]*GuideBar/);
  });

  // Der Just-in-time-Ersatz: der One-Path-Screen behandelt "kein Kanal" am
  // Posten-Button statt als Vorbedingungs-Banner.
  test('der One-Path-Screen übernimmt den Connect-Moment', () => {
    const onePath = source('app/(dashboard)/publish/OnePath.tsx');
    expect(onePath).toContain('connectPrompt');
    expect(onePath).toContain('/connections');
    expect(onePath).toContain('storeAppliedTemplate');
  });
});

describe('Faden-Texte sind in allen Locales vollständig', () => {
  const stepIds = resolveGuide({
    hasProduct: false,
    activeConnections: 0,
    awaitingApproval: 0,
    writerAvailable: true,
    drafts: 0,
    scheduled: 0,
    published: 0,
  }).steps.map((step) => step.id);

  test('jede Locale kennt jeden Schritt mit Label, Hinweis und CTA', () => {
    for (const locale of APP_LOCALES) {
      const copy = getGuideCopy(locale);
      for (const id of stepIds as GuideStepId[]) {
        expect(copy.steps[id].label.length, `${locale}/${id} label`).toBeGreaterThan(0);
        expect(copy.steps[id].hint.length, `${locale}/${id} hint`).toBeGreaterThan(0);
        expect(copy.steps[id].cta.length, `${locale}/${id} cta`).toBeGreaterThan(0);
      }
    }
  });

  test('jede Locale hat die Chrome-Texte der Leiste', () => {
    for (const locale of APP_LOCALES) {
      const copy = getGuideCopy(locale);
      for (const key of [
        'bar_label',
        'you_are_here',
        'show_all',
        'hide_all',
        'done_label',
        'waiting_label',
        'complete_label',
        'complete_hint',
        'complete_cta',
      ] as const) {
        expect(copy[key].length, `${locale}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  test('der Schrittzähler ersetzt beide Platzhalter in jeder Locale', () => {
    for (const locale of APP_LOCALES) {
      const rendered = formatStepOf(getGuideCopy(locale).step_of, 2, 6);
      expect(rendered).toContain('2');
      expect(rendered).toContain('6');
      expect(rendered).not.toContain('{current}');
      expect(rendered).not.toContain('{total}');
    }
  });
});
