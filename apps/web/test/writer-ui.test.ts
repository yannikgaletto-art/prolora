import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  dnaConfidenceTier,
  nextWriterSection,
  reviewHasApprovalContext,
  type WriterReview,
  type WriterSection,
} from '@/app/(dashboard)/publish/writer/writer-model';
import { getWriterCopy } from '@/app/(dashboard)/publish/writer/writer-copy';

function source(relativePath: string): string {
  const file = resolve(process.cwd(), relativePath);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const review: WriterReview = {
  id: 'review-1',
  snapshotHash: 'snapshot-abc',
  title: 'What founders miss about activation',
  preview: 'Most activation problems are really expectation problems.',
  whyNow: 'Repeated in 14 feedback signals and balances this week’s content mix.',
  proposedLocalTime: '31 Jul, 09:30',
  timezone: 'Europe/Berlin',
  proposedUtcTime: '2026-07-31T07:30:00.000Z',
  dnaVersion: 1,
  dnaSampleCount: 2,
  sourceCount: 3,
  warnings: [],
  skippedChecks: [],
  overrides: [],
  changes: [],
  claims: [
    {
      text: 'Repeated in 14 feedback signals',
      sourceLabel: 'Feedback theme · Activation',
      sourceUrl: null,
      verified: true,
    },
  ],
  channels: [
    {
      id: 'variant-linkedin',
      platform: 'linkedin',
      accountName: 'Acme Founder',
      format: 'post',
      content: 'Most activation problems are really expectation problems.',
      segments: [],
      media: [],
      firstComment: null,
      gatePassed: true,
    },
  ],
};

describe('Writer pilot navigation', () => {
  // GOAL-RUN11: die acht gleichrangigen Tabs sind auf Post + Verlauf
  // geschrumpft; Writer bleibt erreichbar, aber im Werkzeuge-Menü (D3).
  test('Writer bleibt über das Werkzeuge-Menü erreichbar', () => {
    const tabs = source('app/(dashboard)/publish/PublishTabs.tsx');

    expect(tabs).toMatch(/key:\s*'writer'[\s\S]*href:\s*'\/publish\/writer'/);
    // Primär sichtbar sind genau zwei Wege: Post (Hauptweg) und Verlauf.
    expect(tabs).toMatch(/key:\s*'compose'[\s\S]*href:\s*'\/publish'/);
    expect(tabs).toMatch(/key:\s*'posts'[\s\S]*href:\s*'\/publish\/posts'/);
    // Alle früheren Tab-Ziele existieren weiter — nichts wurde gelöscht.
    for (const href of [
      '/publish/start',
      '/publish/writer',
      '/publish/pipeline',
      '/publish/calendar',
      '/publish/hub',
      '/publish/media',
    ]) {
      expect(tabs).toContain(`'${href}'`);
    }
  });
});

describe('Writer pilot states and hierarchy', () => {
  test('keeps approval primary and editing, alternate direction and rejection secondary', () => {
    const view = source('app/(dashboard)/publish/writer/WriterView.tsx');
    const reviewCard = source('app/(dashboard)/publish/writer/ReviewCard.tsx');

    expect(view).toContain(`'today'`);
    expect(view).toContain(`'dna'`);
    expect(view).toContain(`'history'`);
    expect(view).toContain('migration_pending');
    expect(view).toContain('runShadow');
    expect(view).toContain('/request-change');
    expect(view).not.toContain('/alternate');
    expect(reviewCard).toContain('data-emphasis="primary"');
    expect(reviewCard).toContain('copy.actions.approve');
    expect(reviewCard).toContain('data-emphasis="secondary"');
    expect(reviewCard).toContain('copy.actions.edit');
    expect(reviewCard).toContain('copy.actions.alternate');
    expect(reviewCard).toContain('copy.actions.reject');
  });

  test('moves segmented navigation predictably with arrow, home and end keys', () => {
    const sections: WriterSection[] = ['today', 'dna', 'history'];
    expect(nextWriterSection('today', 'ArrowRight', sections)).toBe('dna');
    expect(nextWriterSection('history', 'ArrowRight', sections)).toBe('today');
    expect(nextWriterSection('today', 'ArrowLeft', sections)).toBe('history');
    expect(nextWriterSection('dna', 'Home', sections)).toBe('today');
    expect(nextWriterSection('dna', 'End', sections)).toBe('history');
  });

  test('declares accessible focus, tabs, live feedback and reduced-motion behavior', () => {
    const view = source('app/(dashboard)/publish/writer/WriterView.tsx');
    const reviewCard = source('app/(dashboard)/publish/writer/ReviewCard.tsx');

    expect(view).toContain('role="tablist"');
    expect(view).toContain('aria-selected');
    expect(view).toContain('aria-live="polite"');
    expect(view).toContain('motion-reduce:');
    expect(view).toContain('focus-visible:');
    expect(reviewCard).toContain('aria-label');
  });
});

describe('Writer review and Content DNA', () => {
  test('requires exact destination, timing, source and gate context for approval', () => {
    expect(reviewHasApprovalContext(review)).toBe(true);
    expect(reviewHasApprovalContext({ ...review, snapshotHash: '' })).toBe(false);
    expect(reviewHasApprovalContext({ ...review, channels: [] })).toBe(false);
    expect(reviewHasApprovalContext({ ...review, sourceCount: 0, claims: [] })).toBe(false);
    expect(
      reviewHasApprovalContext(
        {
          ...review,
          channels: [
            ...review.channels,
            {
              ...review.channels[0],
              id: 'variant-x',
              platform: 'x',
              gatePassed: false,
            },
          ],
        },
        ['variant-linkedin']
      )
    ).toBe(true);
  });

  test('uses honest confidence tiers instead of false precision', () => {
    const copy = getWriterCopy('en');
    expect(dnaConfidenceTier(0)).toBe('low');
    expect(dnaConfidenceTier(2)).toBe('low');
    expect(dnaConfidenceTier(3)).toBe('preliminary');
    expect(dnaConfidenceTier(5)).toBe('reliable');
    expect(dnaConfidenceTier(15)).toBe('precise');
    expect(copy.dna.confidence.low).toBe('Low confidence');
    expect(copy.dna.confidence.lowHint).toMatch(/more Golden Samples/i);
    expect(JSON.stringify(copy)).not.toContain('100%');
  });

  test('exposes all three sample origins and locked rules without implying automatic learning', () => {
    const dnaPanel = source('app/(dashboard)/publish/writer/ContentDnaPanel.tsx');

    expect(dnaPanel).toContain(`'pasted'`);
    expect(dnaPanel).toContain(`'imported'`);
    expect(dnaPanel).toContain(`'published'`);
    expect(dnaPanel).toContain('lockedRules');
    expect(dnaPanel).toContain('copy.dna.rebuild');
  });
});
