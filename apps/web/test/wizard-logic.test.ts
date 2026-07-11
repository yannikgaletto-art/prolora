// URL → wizard state parsing (D8: broken/stale params degrade, never crash),
// platform targeting and the two storage helpers.
import { describe, expect, it, vi } from 'vitest';
import type { PlatformType } from '@prolora/shared';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { INTENT_INFO, anlaesseForGoal, templatesFor } from '@/lib/templates/guide';
import {
  buildQuery,
  parseWizardState,
  prefillCacheKey,
  readCachedSuggestions,
  readStoredSlots,
  slotsStorageKey,
  targetPlatformsFor,
  writeCachedSuggestions,
  writeStoredSlots,
} from '@/app/(dashboard)/publish/templates/wizard-logic';

const CAT = TEMPLATE_CATALOG;
const params = (q: string) => new URLSearchParams(q);

describe('buildQuery', () => {
  it('builds canonical queries and an empty string for no parts', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ goal: 'value' })).toBe('?goal=value');
    expect(buildQuery({ goal: 'value', anlass: 'nichts', template: 'x-y' })).toBe(
      '?goal=value&anlass=nichts&template=x-y'
    );
  });
});

describe('parseWizardState', () => {
  it('empty query → step 1', () => {
    const state = parseWizardState(params(''), CAT);
    expect(state.step).toBe(1);
    expect(state.canonicalQuery).toBe('');
  });

  it('unknown goal → step 1 (D8, never a crash)', () => {
    const state = parseWizardState(params('goal=quatsch&anlass=zahl&template=x'), CAT);
    expect(state.step).toBe(1);
    expect(state.canonicalQuery).toBe('');
  });

  it('valid goal only → step 2 with canonical query', () => {
    const state = parseWizardState(params('goal=value'), CAT);
    expect(state.step).toBe(2);
    expect(state.goal).toBe('value');
    expect(state.canonicalQuery).toBe('?goal=value');
  });

  it('anlass that does not match the goal → back to step 2', () => {
    // Find an anlass NOT offered for 'value' to prove the mismatch path.
    const offered = new Set(anlaesseForGoal(CAT, 'value').map((a) => a.key));
    const foreign = ['community', 'meinung', 'neu', 'frage'].find((k) => !offered.has(k));
    expect(foreign).toBeDefined();
    const state = parseWizardState(params(`goal=value&anlass=${foreign}`), CAT);
    expect(state.step).toBe(2);
    expect(state.canonicalQuery).toBe('?goal=value');
  });

  it('valid goal + anlass → step 3', () => {
    const anlass = anlaesseForGoal(CAT, 'value')[0]!;
    const state = parseWizardState(params(`goal=value&anlass=${anlass.key}`), CAT);
    expect(state.step).toBe(3);
    expect(state.anlassKey).toBe(anlass.key);
  });

  it('stale template id → step 3 fallback, canonical query drops the template', () => {
    const anlass = anlaesseForGoal(CAT, 'value')[0]!;
    const state = parseWizardState(
      params(`goal=value&anlass=${anlass.key}&template=geloescht-2027`),
      CAT
    );
    expect(state.step).toBe(3);
    expect(state.templateId).toBeUndefined();
    expect(state.canonicalQuery).toBe(`?goal=value&anlass=${anlass.key}`);
  });

  it('valid full triple → step 4', () => {
    const anlass = anlaesseForGoal(CAT, 'value')[0]!;
    const template = templatesFor(CAT, 'value', anlass.key)[0]!;
    const state = parseWizardState(
      params(`goal=value&anlass=${anlass.key}&template=${template.id}`),
      CAT
    );
    expect(state.step).toBe(4);
    expect(state.templateId).toBe(template.id);
    expect(state.canonicalQuery).toBe(`?goal=value&anlass=${anlass.key}&template=${template.id}`);
  });

  it('single-template combinations get autoExpandTemplateId on step 3', () => {
    // The curated catalog has combos with exactly one template (T2) — find one.
    let found = false;
    for (const intent of INTENT_INFO) {
      for (const anlass of anlaesseForGoal(CAT, intent.key)) {
        const matching = templatesFor(CAT, intent.key, anlass.key);
        if (matching.length !== 1) continue;
        found = true;
        const state = parseWizardState(params(`goal=${intent.key}&anlass=${anlass.key}`), CAT);
        expect(state.step).toBe(3);
        expect(state.autoExpandTemplateId).toBe(matching[0]!.id);
      }
    }
    expect(found).toBe(true);
  });
});

describe('targetPlatformsFor', () => {
  const template = { recommended_platforms: ['linkedin', 'x'] as PlatformType[] };

  it('intersects recommended with active platforms', () => {
    expect(targetPlatformsFor(template, new Set<PlatformType>(['x', 'mastodon']))).toEqual(['x']);
  });

  it('falls back to recommended when nothing matches (RUN4 behavior)', () => {
    expect(targetPlatformsFor(template, new Set<PlatformType>(['telegram']))).toEqual([
      'linkedin',
      'x',
    ]);
    expect(targetPlatformsFor(template, new Set<PlatformType>())).toEqual(['linkedin', 'x']);
  });
});

describe('storage helpers (D8: private mode must never break the wizard)', () => {
  it('cache keys are scoped by workspace and template', () => {
    expect(prefillCacheKey('ws-1', 'tpl-1')).toBe('prolora:prefill:ws-1:tpl-1');
    expect(slotsStorageKey('tpl-1')).toBe('prolora:guide-slots:tpl-1');
  });

  it('readCachedSuggestions filters garbage and survives broken storage', () => {
    expect(readCachedSuggestions(null, 'k')).toBeNull();
    expect(readCachedSuggestions({ getItem: () => 'kein json{' }, 'k')).toBeNull();
    expect(readCachedSuggestions({ getItem: () => '{"nicht":"array"}' }, 'k')).toBeNull();
    expect(
      readCachedSuggestions(
        {
          getItem: () =>
            JSON.stringify([
              { key: 'a', value: 'ok', is_example: false },
              { key: 42, value: 'kaputt' },
              'string',
            ]),
        },
        'k'
      )
    ).toEqual([{ key: 'a', value: 'ok', is_example: false }]);
    expect(
      readCachedSuggestions(
        {
          getItem: () => {
            throw new Error('private mode');
          },
        },
        'k'
      )
    ).toBeNull();
  });

  it('writeCachedSuggestions swallows storage errors', () => {
    const throwing = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeCachedSuggestions(throwing, 'k', [])).not.toThrow();
    expect(() => writeCachedSuggestions(null, 'k', [])).not.toThrow();
    const setItem = vi.fn();
    writeCachedSuggestions({ setItem }, 'k', [{ key: 'a', value: 'v', is_example: false }]);
    expect(setItem).toHaveBeenCalledWith('k', JSON.stringify([{ key: 'a', value: 'v', is_example: false }]));
  });

  it('readStoredSlots keeps only string values and survives garbage', () => {
    expect(readStoredSlots(null, 'k')).toEqual({});
    expect(readStoredSlots({ getItem: () => 'kaputt{' }, 'k')).toEqual({});
    expect(readStoredSlots({ getItem: () => '[1,2]' }, 'k')).toEqual({});
    expect(
      readStoredSlots({ getItem: () => JSON.stringify({ a: 'text', b: 42, c: null }) }, 'k')
    ).toEqual({ a: 'text' });
  });

  it('writeStoredSlots swallows storage errors', () => {
    const throwing = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeStoredSlots(throwing, 'k', { a: 'x' })).not.toThrow();
    expect(() => writeStoredSlots(null, 'k', {})).not.toThrow();
  });
});
