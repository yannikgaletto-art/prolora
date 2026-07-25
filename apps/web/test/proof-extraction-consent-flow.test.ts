// Plan 2 / 2A.3 — der Weg vom Vorschlag zum Beleg.
//
// Hier hängt die harte Regel des Plans: ein proof_asset entsteht NUR über den
// expliziten Accept-Aufruf, und ein zustimmungspflichtiges Kundenzitat ohne
// Zustimmungsbeleg ist danach im Quality-Gate NICHT verwendbar.
import { beforeEach, describe, expect, test, vi } from 'vitest';

interface MockResponse {
  data: unknown;
  error: { code: string; message: string } | null;
}

const state: {
  responses: MockResponse[];
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
} = { responses: [], inserts: [], updates: [] };

function chain(table: string): Record<string, unknown> {
  const settle = () => Promise.resolve(state.responses.shift() ?? { data: null, error: null });
  const target: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'returns']) {
    target[method] = () => target;
  }
  target.insert = (payload: Record<string, unknown>) => {
    state.inserts.push({ table, payload });
    return target;
  };
  target.update = (payload: Record<string, unknown>) => {
    state.updates.push({ table, payload });
    return target;
  };
  target.upsert = (payload: Record<string, unknown>) => {
    state.inserts.push({ table, payload });
    return target;
  };
  target.maybeSingle = settle;
  target.single = settle;
  target.then = (resolve: (value: MockResponse) => unknown) => settle().then(resolve);
  return target;
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return { ...original, getServiceDb: () => ({ from: (table: string) => chain(table) }) };
});

import { ApiError } from '@/lib/api/http';
import { acceptProofSuggestion, listGateUsableProofAssets } from '@/lib/feedback/proof-extraction';

const quoteSuggestion = {
  id: 'sug-1',
  workspace_id: 'ws-1',
  feedback_item_id: 'fb-1',
  suggested_type: 'customer_quote',
  content: 'Unsere Bearbeitungszeit ist um 40 % gesunken.',
  source_url: 'https://example.test/r/1',
  source_author: 'Lena K.',
  source_platform: 'trustpilot',
  rationale: 'Aussage einer identifizierbaren Person.',
  confidence: 0.55,
  requires_consent: true,
  status: 'pending',
  decided_at: null,
  decided_by: null,
  proof_asset_id: null,
  created_at: '2026-07-20T10:00:00.000Z',
};

const metricSuggestion = { ...quoteSuggestion, id: 'sug-2', suggested_type: 'metric', requires_consent: false, source_author: null };

beforeEach(() => {
  state.responses = [];
  state.inserts = [];
  state.updates = [];
});

describe('acceptProofSuggestion', () => {
  test('Kundenzitat ohne Zustimmungsbeleg -> pending, im Gate NICHT nutzbar', async () => {
    state.responses.push({ data: quoteSuggestion, error: null });
    state.responses.push({ data: { id: 'asset-1' }, error: null });
    state.responses.push({ data: null, error: null });

    const result = await acceptProofSuggestion('ws-1', 'sug-1');
    expect(result.consentStatus).toBe('pending');
    expect(result.usableInGate).toBe(false);

    const insert = state.inserts.find((entry) => entry.table === 'proof_assets');
    expect(insert?.payload.consent_status).toBe('pending');
    expect(insert?.payload.consent_recorded_at).toBeNull();
    // Herkunft hängt am Beleg (DSGVO + Anti-Fabrikation).
    expect(insert?.payload.source_feedback_item_id).toBe('fb-1');
    expect(insert?.payload.source_url).toBe('https://example.test/r/1');
    expect(insert?.payload.origin).toBe('feedback_suggestion');
    // Wortlaut unverändert.
    expect(insert?.payload.content).toBe(quoteSuggestion.content);
  });

  test('mit Zustimmungsbeleg -> granted und im Gate nutzbar', async () => {
    state.responses.push({ data: quoteSuggestion, error: null });
    state.responses.push({ data: { id: 'asset-2' }, error: null });
    state.responses.push({ data: null, error: null });

    const result = await acceptProofSuggestion('ws-1', 'sug-1', {
      consentReference: 'E-Mail vom 21.07.2026, Betreff "Freigabe Zitat"',
      decidedBy: 'user-1',
    });
    expect(result.consentStatus).toBe('granted');
    expect(result.usableInGate).toBe(true);

    const insert = state.inserts.find((entry) => entry.table === 'proof_assets');
    expect(insert?.payload.consent_reference).toContain('Freigabe Zitat');
    expect(insert?.payload.consent_recorded_at).not.toBeNull();
    expect(state.updates[0]?.payload.status).toBe('accepted');
    expect(state.updates[0]?.payload.decided_by).toBe('user-1');
  });

  test('eigene Metrik ohne Personenbezug -> not_required', async () => {
    state.responses.push({ data: metricSuggestion, error: null });
    state.responses.push({ data: { id: 'asset-3' }, error: null });
    state.responses.push({ data: null, error: null });

    const result = await acceptProofSuggestion('ws-1', 'sug-2');
    expect(result.consentStatus).toBe('not_required');
    expect(result.usableInGate).toBe(true);
  });

  test('unbekannter Vorschlag -> 404, kein Beleg', async () => {
    state.responses.push({ data: null, error: null });
    await expect(acceptProofSuggestion('ws-1', 'sug-x')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.status === 404
    );
    expect(state.inserts).toHaveLength(0);
  });

  test('bereits übernommen -> 409, kein zweiter Beleg', async () => {
    state.responses.push({
      data: { ...quoteSuggestion, status: 'accepted', proof_asset_id: 'asset-1' },
      error: null,
    });
    await expect(acceptProofSuggestion('ws-1', 'sug-1')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'already_accepted'
    );
    expect(state.inserts).toHaveLength(0);
  });

  test('ohne Migration 016 -> 503 migration_pending statt 500', async () => {
    state.responses.push({ data: null, error: { code: 'PGRST205', message: 'missing table' } });
    await expect(acceptProofSuggestion('ws-1', 'sug-1')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'migration_pending'
    );
  });
});

describe('listGateUsableProofAssets', () => {
  test('filtert pending/denied heraus', async () => {
    state.responses.push({
      data: [
        { id: 'a', type: 'metric', content: 'x', source_url: null, verified_at: null, consent_status: 'not_required', created_at: '2026-07-01T00:00:00.000Z' },
        { id: 'b', type: 'customer_quote', content: 'y', source_url: null, verified_at: null, consent_status: 'pending', created_at: '2026-07-01T00:00:00.000Z' },
        { id: 'c', type: 'customer_quote', content: 'z', source_url: null, verified_at: null, consent_status: 'granted', created_at: '2026-07-01T00:00:00.000Z' },
        { id: 'd', type: 'customer_quote', content: 'w', source_url: null, verified_at: null, consent_status: 'denied', created_at: '2026-07-01T00:00:00.000Z' },
      ],
      error: null,
    });
    const assets = await listGateUsableProofAssets('ws-1');
    expect(assets.map((asset) => asset.id)).toEqual(['a', 'c']);
  });

  test('ohne consent_status-Spalte wird ohne sie erneut gelesen', async () => {
    state.responses.push({ data: null, error: { code: '42703', message: 'column does not exist' } });
    state.responses.push({
      data: [{ id: 'a', type: 'metric', content: 'x', source_url: null, verified_at: null, created_at: '2026-07-01T00:00:00.000Z' }],
      error: null,
    });
    const assets = await listGateUsableProofAssets('ws-1');
    expect(assets).toHaveLength(1);
    expect(assets[0].consentStatus).toBe('not_required');
  });
});
