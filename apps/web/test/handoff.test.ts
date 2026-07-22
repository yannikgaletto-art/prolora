// KRITISCH (Regression-Guard): the wizard → composer handoff. A broken parse
// here silently loses the user's paid draft — every branch is pinned down.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_KEY,
  HANDOFF_TTL_MS,
  parseAppliedTemplate,
  storeAppliedTemplate,
  takeAppliedTemplate,
  type AppliedTemplate,
} from '@/app/(dashboard)/publish/handoff';

const NOW = 1_760_000_000_000;

const payload: AppliedTemplate = {
  content: 'Mein Entwurf',
  firstComment: 'Link folgt',
  connectionIds: ['conn-1', 'conn-2'],
  extras: { templateName: 'Ehrliches Review', slides: ['Slide 1'], manualSteps: ['PDF hochladen'] },
};

function raw(overrides: Record<string, unknown> = {}, ts = NOW): string {
  return JSON.stringify({ ...payload, ts, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAppliedTemplate (pure core)', () => {
  it('null / broken JSON / non-object → none', () => {
    expect(parseAppliedTemplate(null, NOW)).toEqual({ status: 'none' });
    expect(parseAppliedTemplate('kein json{', NOW)).toEqual({ status: 'none' });
    expect(parseAppliedTemplate('"string"', NOW)).toEqual({ status: 'none' });
    expect(parseAppliedTemplate('null', NOW)).toEqual({ status: 'none' });
  });

  it('missing content or ts → none (never a half-applied draft)', () => {
    expect(parseAppliedTemplate(JSON.stringify({ ts: NOW }), NOW)).toEqual({ status: 'none' });
    expect(parseAppliedTemplate(JSON.stringify({ content: 'x' }), NOW)).toEqual({
      status: 'none',
    });
  });

  it('fresh payload → applied with all fields', () => {
    const result = parseAppliedTemplate(raw(), NOW + 1000);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.payload.content).toBe('Mein Entwurf');
    expect(result.payload.firstComment).toBe('Link folgt');
    expect(result.payload.connectionIds).toEqual(['conn-1', 'conn-2']);
    expect(result.payload.extras?.templateName).toBe('Ehrliches Review');
  });

  it('sanitizes malformed optional fields instead of failing', () => {
    const result = parseAppliedTemplate(
      raw({ firstComment: 42, connectionIds: ['ok', 7, null], extras: 'kaputt' }),
      NOW
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.payload.firstComment).toBeUndefined();
    expect(result.payload.connectionIds).toEqual(['ok']);
    expect(result.payload.extras).toBeNull();
  });

  it('validates extras field-by-field (poisoned storage must not crash the composer)', () => {
    // templateName missing/wrong type → extras dropped entirely.
    const noName = parseAppliedTemplate(raw({ extras: { templateName: 42 } }), NOW);
    expect(noName.status).toBe('applied');
    if (noName.status === 'applied') expect(noName.payload.extras).toBeNull();

    // slides as string (not array) → undefined; mixed array → strings only.
    const mixed = parseAppliedTemplate(
      raw({ extras: { templateName: 'T', slides: 'kaputt', manualSteps: ['ok', 7, null] } }),
      NOW
    );
    expect(mixed.status).toBe('applied');
    if (mixed.status !== 'applied') return;
    expect(mixed.payload.extras).toEqual({
      templateName: 'T',
      slides: undefined,
      manualSteps: ['ok'],
    });
  });

  it('parses media entries and silently drops malformed ones', () => {
    const result = parseAppliedTemplate(
      raw({
        media: [
          {
            type: 'image',
            url: 'workspaces/w1/media/a/original.jpg',
            mime_type: 'image/jpeg',
            preview_url: 'https://signed.example/a',
          },
          { type: 'gif', url: 'wrong-type' },
          { type: 'video', url: 42 },
          { type: 'image' },
          'kaputt',
          null,
        ],
      }),
      NOW
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.payload.media).toEqual([
      {
        type: 'image',
        url: 'workspaces/w1/media/a/original.jpg',
        mime_type: 'image/jpeg',
        alt_text: undefined,
        preview_url: 'https://signed.example/a',
      },
    ]);
  });

  it('media missing, non-array, or all-invalid → undefined (composer attaches nothing)', () => {
    for (const media of [undefined, 'kaputt', [], [{ type: 'image' }]]) {
      const result = parseAppliedTemplate(raw({ media }), NOW);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') expect(result.payload.media).toBeUndefined();
    }
  });

  it('respects the TTL boundary exactly (> TTL expires, = TTL applies)', () => {
    expect(parseAppliedTemplate(raw(), NOW + HANDOFF_TTL_MS).status).toBe('applied');
    expect(parseAppliedTemplate(raw(), NOW + HANDOFF_TTL_MS + 1).status).toBe('expired');
  });
});

describe('store/take through sessionStorage', () => {
  it('stores under HANDOFF_KEY and read-and-clears exactly once', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        setItem: (k: string, v: string) => map.set(k, v),
        getItem: (k: string) => map.get(k) ?? null,
        removeItem: (k: string) => map.delete(k),
      },
    });

    storeAppliedTemplate(payload, NOW);
    expect(map.has(HANDOFF_KEY)).toBe(true);

    const first = takeAppliedTemplate(NOW + 500);
    expect(first.status).toBe('applied');
    expect(map.has(HANDOFF_KEY)).toBe(false);

    // Second take must find nothing — no double-apply on remount.
    expect(takeAppliedTemplate(NOW + 600)).toEqual({ status: 'none' });
  });

  it('expired payload surfaces as expired via take (V1 toast path)', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        setItem: (k: string, v: string) => map.set(k, v),
        getItem: (k: string) => map.get(k) ?? null,
        removeItem: (k: string) => map.delete(k),
      },
    });

    storeAppliedTemplate(payload, NOW);
    expect(takeAppliedTemplate(NOW + HANDOFF_TTL_MS + 1).status).toBe('expired');
  });

  it('memory fallback carries the payload when sessionStorage throws (Safari private, D8)', () => {
    const throwing = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      getItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('window', { sessionStorage: throwing });

    storeAppliedTemplate(payload, NOW);
    const result = takeAppliedTemplate(NOW + 500);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.payload.content).toBe('Mein Entwurf');

    // Fallback is also read-and-clear.
    expect(takeAppliedTemplate(NOW + 600)).toEqual({ status: 'none' });
  });
});
