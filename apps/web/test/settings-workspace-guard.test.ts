// Regression test for the 2026-07-25 incident: /settings crashed in the
// Server Components render for every product except the oldest one. The guard
// resolved "the" workspace via findWorkspace(supabase) — which returns the
// first row by created_at — while the page resolves the ACTIVE workspace from
// the switcher cookie (GOAL-RUN9 §9). Any second product therefore failed the
// equality check inside listApiKeys() and threw during render.
import { describe, expect, test, vi } from 'vitest';

const OLDEST = 'e7f3a7d5-0000-0000-0000-000000000001';
const NEWER = 'f85344b5-0000-0000-0000-000000000002';

const ROWS = [
  { id: OLDEST, name: 'yannik.galetto', slug: 'yannik-galetto', settings: { onboarding_completed: true } },
  { id: NEWER, name: 'Pathly', slug: 'pathly', settings: { onboarding_completed: true } },
];

// Minimal thenable chain: listWorkspaces() does
// .from(...).select(...).order(...).returns<T>()
function workspaceChain(): Record<string, unknown> {
  const result = Promise.resolve({ data: ROWS, error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'eq', 'returns']) {
    chain[method] = () => Object.assign(result, chain);
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: () => workspaceChain() }),
}));

import { assertOwnWorkspace } from '@/lib/settings/workspace-guard';

describe('assertOwnWorkspace', () => {
  test('accepts the oldest workspace', async () => {
    await expect(assertOwnWorkspace(OLDEST)).resolves.toBe(OLDEST);
  });

  test('accepts a second product workspace (the bug)', async () => {
    await expect(assertOwnWorkspace(NEWER)).resolves.toBe(NEWER);
  });

  test('still rejects a workspace the caller cannot see', async () => {
    await expect(assertOwnWorkspace('00000000-0000-0000-0000-0000000000ff')).rejects.toThrow(
      'Not authorized for this workspace.'
    );
  });
});
