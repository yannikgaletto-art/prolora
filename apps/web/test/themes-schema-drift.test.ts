// Plan 2 §9 — Migrations-STOP-Gate: 016/018 liegen im Repo, sind aber nicht
// angewendet. Bis dahin muss jeder neue Codepfad ohne Tabelle sauber
// degradieren statt eine Seite oder einen Job zu killen.
import { describe, expect, test, vi } from 'vitest';

const missingTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.feedback_themes' in the schema cache",
};

function missingTableChain(): Record<string, unknown> {
  const result = Promise.resolve({ data: null, error: missingTableError });
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'eq', 'neq', 'or', 'in', 'is', 'not', 'gte', 'lte', 'order',
    'limit', 'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle', 'returns',
  ];
  for (const method of methods) {
    chain[method] = () => Object.assign(result, chain);
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return { ...original, getServiceDb: () => ({ from: () => missingTableChain() }) };
});

import { clusterFeedbackThemes, listThemeMemberIds, listThemes, rescoreMomentum } from '@/lib/feedback/themes';
import { getBrandProfile, DEFAULT_BRAND_PROFILE } from '@/lib/media/brand-profile';
import { listProofSuggestions, scanFeedbackForProofs } from '@/lib/feedback/proof-extraction';

describe('ohne Migration 016', () => {
  test('Themen-Liste ist leer statt kaputt', async () => {
    await expect(listThemes('ws-1')).resolves.toEqual([]);
    await expect(listThemeMemberIds('ws-1', 'theme-1')).resolves.toEqual([]);
  });

  test('ein Clustering-Lauf meldet migration_pending, ohne zu werfen', async () => {
    const result = await clusterFeedbackThemes('ws-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('migration_pending');
  });

  test('Momentum-Neuberechnung ist ein No-Op', async () => {
    await expect(rescoreMomentum('ws-1')).resolves.toBe(0);
  });

  test('Proof-Scan meldet migration_pending, legt nichts an', async () => {
    const result = await scanFeedbackForProofs('ws-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('migration_pending');
    expect(result.suggestionsCreated).toBe(0);
  });

  test('Vorschlagsliste ist leer statt kaputt', async () => {
    await expect(listProofSuggestions('ws-1')).resolves.toEqual([]);
  });
});

describe('ohne Migration 018', () => {
  test('das Brand-Profil fällt auf die Defaults zurück, damit Templates rendern', async () => {
    await expect(getBrandProfile('ws-1')).resolves.toEqual(DEFAULT_BRAND_PROFILE);
  });
});
