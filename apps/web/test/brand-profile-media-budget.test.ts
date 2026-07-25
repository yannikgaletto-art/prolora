// Plan 2 / Entscheidung D3 — plan-abhängiges Media-Budget.
//
// Zugesichert wird: die Grenze kommt aus der Workspace-Zeile, fällt ohne Spalte
// (Migration 018 noch nicht angewendet) sauber auf den Plan-Default zurück und
// landet notfalls bei 10 EUR. Ledger und Reservierungs-RPC bleiben unangetastet
// — nur der übergebene p_limit ist dynamisch.
import { beforeEach, describe, expect, test, vi } from 'vitest';

interface MockResponse {
  data: unknown;
  error: { code: string; message: string } | null;
}

const state: { responses: MockResponse[]; selects: string[] } = { responses: [], selects: [] };

function chain(): Record<string, unknown> {
  const settle = () =>
    Promise.resolve(state.responses.shift() ?? { data: null, error: null });
  const target: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'returns']) {
    target[method] = () => target;
  }
  target.select = (columns: string) => {
    state.selects.push(columns);
    return target;
  };
  target.maybeSingle = settle;
  target.single = settle;
  target.then = (resolve: (value: MockResponse) => unknown) => settle().then(resolve);
  return target;
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return { ...original, getServiceDb: () => ({ from: () => chain() }) };
});

import {
  MEDIA_BUDGET_LIMIT_EUR,
  PLAN_MEDIA_BUDGET_EUR,
  planLimit,
  resolveMediaBudgetLimitEur,
} from '@/lib/media/generation';

beforeEach(() => {
  state.responses = [];
  state.selects = [];
});

describe('planLimit', () => {
  test('bildet die Plan-Staffel ab', () => {
    expect(planLimit('starter')).toBe(10);
    expect(planLimit('pro')).toBe(60);
    expect(planLimit('agency')).toBe(200);
  });

  test('unbekannter oder fehlender Plan fällt auf 10 EUR', () => {
    expect(planLimit(null)).toBe(MEDIA_BUDGET_LIMIT_EUR);
    expect(planLimit('enterprise')).toBe(MEDIA_BUDGET_LIMIT_EUR);
    expect(PLAN_MEDIA_BUDGET_EUR.starter).toBe(MEDIA_BUDGET_LIMIT_EUR);
  });
});

describe('resolveMediaBudgetLimitEur', () => {
  test('nimmt den Wert aus der Workspace-Spalte', async () => {
    state.responses.push({ data: { plan: 'pro', media_budget_limit_eur: 60 }, error: null });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(60);
  });

  test('eine manuell erhöhte Grenze schlägt den Plan-Default', async () => {
    state.responses.push({ data: { plan: 'starter', media_budget_limit_eur: 25 }, error: null });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(25);
  });

  test('ohne Spalte (Migration 018 fehlt) wird über den Plan aufgelöst', async () => {
    state.responses.push({ data: null, error: { code: '42703', message: 'column does not exist' } });
    state.responses.push({ data: { plan: 'agency' }, error: null });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(200);
    // Der zweite Versuch fragt bewusst nur noch den Plan ab.
    expect(state.selects).toEqual(['plan, media_budget_limit_eur', 'plan']);
  });

  test('ohne auffindbaren Workspace bleibt es bei 10 EUR', async () => {
    state.responses.push({ data: null, error: { code: 'PGRST205', message: 'missing table' } });
    state.responses.push({ data: null, error: null });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(MEDIA_BUDGET_LIMIT_EUR);
  });

  test('ein echter DB-Fehler blockiert nicht, sondern nutzt den Default', async () => {
    state.responses.push({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(MEDIA_BUDGET_LIMIT_EUR);
  });

  test('NULL in der Spalte fällt auf den Plan-Default', async () => {
    state.responses.push({ data: { plan: 'pro', media_budget_limit_eur: null }, error: null });
    await expect(resolveMediaBudgetLimitEur('ws-1')).resolves.toBe(60);
  });
});
