// Verdrahtungstest im Hausmuster von `writer-ui.test.ts`: das Testsetup läuft
// ohne DOM, also wird die Quelle gelesen statt gerendert.
//
// Warum es diese Datei gibt: `resolveGuide` kann perfekt funktionieren und der
// Faden trotzdem nie erscheinen, weil ein Aufrufer ihn nicht durchreicht. Genau
// diese Lücke ("Test befriedigt, Verhalten unverändert") soll hier auffallen.
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
const guideBar = source('app/components/GuideBar.tsx');

describe('Faden ist tatsächlich verdrahtet', () => {
  test('das Dashboard-Layout lädt den Zustand und löst ihn auf', () => {
    expect(layout).toContain('loadGuideState');
    expect(layout).toContain('resolveGuide');
    expect(layout).toContain('getGuideCopy');
  });

  test('das Layout reicht den Faden an die Shell durch', () => {
    expect(layout).toMatch(/<AppShell[^>]*guide=\{guide\}/s);
  });

  test('die Shell rendert die Leiste wirklich', () => {
    expect(appShell).toContain('<GuideBar');
    expect(appShell).toMatch(/guide &&\s*<GuideBar/);
  });

  // Ein Fehler im Faden darf nie das ganze Dashboard verhindern.
  test('das Layout fängt Fehler des Fadens ab', () => {
    expect(layout).toMatch(/try\s*\{[\s\S]*loadGuideState[\s\S]*\}\s*catch/);
  });

  test('die Leiste ist eine Client-Komponente', () => {
    expect(guideBar.trimStart().startsWith("'use client'")).toBe(true);
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
