import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({
      rpc: mocks.rpc,
      from: mocks.from,
    }),
  };
});

import {
  ALLOWED_TRANSITIONS,
  CONTENT_ITEM_STATES,
  canTransition,
  transitionContentItem,
  type ContentItemRow,
} from '@/lib/pipeline/state';
import {
  POST_ITEM_ROW_COLUMNS,
  POST_ITEM_WRITER_INTEGRITY_COLUMNS,
  type PostItemRow,
} from '@/lib/db';

const currentItem: ContentItemRow = {
  id: 'item-1',
  workspace_id: 'workspace-1',
  state: 'gated',
  signal_ref: 'signal-1',
  signal_kind: 'feedback_theme',
  title: 'A useful signal',
  strength: 0.8,
  evidence: {
    proofAssetIds: [],
    feedbackItemIds: [],
    communityIds: [],
    referenceIds: [],
  },
  mix_bucket: 'insight',
  angle: null,
  concept: null,
  gate_result: null,
  rejected_reason: null,
  stale_after: null,
  state_entered_at: '2026-07-30T12:00:00.000Z',
  stalled_at: null,
  post_group_id: null,
  scheduled_at: null,
  created_at: '2026-07-30T12:00:00.000Z',
  updated_at: '2026-07-30T12:00:00.000Z',
};

function readCurrentItemChain() {
  const result = Promise.resolve({ data: currentItem, error: null });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'maybeSingle']) {
    chain[method] = vi.fn(() => Object.assign(result, chain));
  }
  return Object.assign(result, chain);
}

function legacyUpdateChain() {
  const result = Promise.resolve({
    data: { ...currentItem, state: 'scheduled' },
    error: null,
  });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['update', 'eq', 'select', 'maybeSingle']) {
    chain[method] = vi.fn(() => Object.assign(result, chain));
  }
  return Object.assign(result, chain);
}

function transitionInsertChain() {
  const result = Promise.resolve({ data: null, error: null });
  return Object.assign(result, {
    insert: vi.fn(() => result),
  });
}

describe('writer approval state', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
  });

  test('routes gated work through explicit approval without skipping delivery', () => {
    expect(CONTENT_ITEM_STATES).toContain('awaiting_approval');
    expect(canTransition('gated', 'awaiting_approval')).toBe(true);
    expect(ALLOWED_TRANSITIONS.awaiting_approval).toEqual([
      'drafted',
      'scheduled',
      'rejected',
    ]);
    expect(canTransition('awaiting_approval', 'published')).toBe(false);
  });

  test('persists the state and audit through the atomic RPC', async () => {
    mocks.from.mockReturnValue(readCurrentItemChain());
    mocks.rpc.mockResolvedValue({
      data: [{ ...currentItem, state: 'awaiting_approval' }],
      error: null,
    });

    await expect(
      transitionContentItem('workspace-1', 'item-1', {
        to: 'awaiting_approval',
        reason: 'Writer bundle is ready for review',
        actor: 'system',
        metadata: { review_id: 'review-1' },
      })
    ).resolves.toMatchObject({ id: 'item-1', state: 'awaiting_approval' });

    expect(mocks.rpc).toHaveBeenCalledWith('transition_content_item_atomic', {
      p_workspace_id: 'workspace-1',
      p_item_id: 'item-1',
      p_expected_state: 'gated',
      p_to_state: 'awaiting_approval',
      p_reason: 'Writer bundle is ready for review',
      p_actor: 'system',
      p_actor_id: null,
      p_metadata: { review_id: 'review-1' },
      p_patch: {},
      p_scheduled_at: null,
    });
  });

  test('uses the scoped legacy transition only when the named atomic RPC is missing', async () => {
    const readChain = readCurrentItemChain();
    const updateChain = legacyUpdateChain();
    const insertChain = transitionInsertChain();
    let contentItemCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'content_items') {
        contentItemCalls += 1;
        return contentItemCalls === 1 ? readChain : updateChain;
      }
      if (table === 'content_item_transitions') return insertChain;
      throw new Error(`unexpected table ${table}`);
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.transition_content_item_atomic',
      },
    });

    await expect(
      transitionContentItem('workspace-1', 'item-1', {
        to: 'scheduled',
        reason: 'Legacy deployment keeps the existing scheduling flow available',
        actor: 'system',
      })
    ).resolves.toMatchObject({ state: 'scheduled' });

    expect(mocks.from).toHaveBeenCalledWith('content_item_transitions');
  });

  test('reports migration_pending instead of falling back for awaiting_approval', async () => {
    mocks.from.mockReturnValue(readCurrentItemChain());
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.transition_content_item_atomic',
      },
    });

    await expect(
      transitionContentItem('workspace-1', 'item-1', {
        to: 'awaiting_approval',
        reason: 'Writer bundle is ready for review',
        actor: 'system',
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'migration_pending'
    );
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  test('does not fall back when 42883 names a different missing function', async () => {
    mocks.from.mockReturnValue(readCurrentItemChain());
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '42883',
        message: 'function public.some_other_function(uuid) does not exist',
      },
    });

    await expect(
      transitionContentItem('workspace-1', 'item-1', {
        to: 'scheduled',
        reason: 'Schedule after gate',
        actor: 'system',
      })
    ).rejects.toThrow(/some_other_function/);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  test('rejects caller-controlled reserved metadata before touching the RPC', async () => {
    mocks.from.mockReturnValue(readCurrentItemChain());

    await expect(
      transitionContentItem('workspace-1', 'item-1', {
        to: 'awaiting_approval',
        reason: 'Writer bundle is ready for review',
        actor: 'system',
        metadata: {
          __content_item_patch: {
            post_group_id: '00000000-0000-0000-0000-000000000001',
          },
        },
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'invalid_transition_metadata'
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('migration 020 writer integrity contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), '../../supabase/migrations/020_writer_integrity.sql'),
    'utf8'
  );

  test('extends state and links one writer variant to at most one post item', () => {
    expect(migration).toMatch(/awaiting_approval/);
    expect(migration).toMatch(/content_item_variant_id UUID/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*post_items[\s\S]*content_item_variant_id[\s\S]*WHERE content_item_variant_id IS NOT NULL/i
    );
  });

  test('makes migration-optional PostItemRow omissions explicit', () => {
    const typedRow: Pick<
      PostItemRow,
      | 'content_item_variant_id'
      | 'publish_claim_attempt_id'
      | 'publish_claimed_at'
      | 'publish_claim_lease_until'
    > = {
      content_item_variant_id: null,
      publish_claim_attempt_id: null,
      publish_claimed_at: null,
      publish_claim_lease_until: null,
    };

    expect(typedRow).toBeDefined();
    expect(POST_ITEM_WRITER_INTEGRITY_COLUMNS).toEqual([
      'content_item_variant_id',
      'publish_claim_attempt_id',
      'publish_claimed_at',
      'publish_claim_lease_until',
    ]);
    for (const optionalColumn of POST_ITEM_WRITER_INTEGRITY_COLUMNS) {
      expect(POST_ITEM_ROW_COLUMNS.split(', ')).not.toContain(optionalColumn);
    }
  });

  test('makes transitions atomic, workspace-scoped and row-locked', () => {
    const transitionFunction = migration.match(
      /CREATE OR REPLACE FUNCTION transition_content_item_atomic[\s\S]*?\$\$;/
    )?.[0];

    expect(transitionFunction).toBeDefined();
    expect(transitionFunction).toMatch(/SECURITY DEFINER/);
    expect(transitionFunction).toMatch(/SET search_path\s*=\s*public/);
    expect(transitionFunction).toMatch(/workspace_id\s*=\s*p_workspace_id/);
    expect(transitionFunction).toMatch(/FOR UPDATE/);
    expect(transitionFunction).toMatch(/INSERT INTO (?:public\.)?content_item_transitions/);
    expect(transitionFunction).toMatch(/p_patch JSONB/);
    expect(transitionFunction).not.toMatch(/p_metadata\s*->/);
  });

  test('claims publishing with an attempt lease and exactly-one-winner row lock', () => {
    const claimFunction = migration.match(
      /CREATE OR REPLACE FUNCTION claim_post_item[\s\S]*?\$\$;/
    )?.[0];

    expect(migration).toMatch(/publish_claim_attempt_id UUID/);
    expect(migration).toMatch(/publish_claim_lease_until TIMESTAMPTZ/);
    expect(claimFunction).toBeDefined();
    expect(claimFunction).toMatch(/SECURITY DEFINER/);
    expect(claimFunction).toMatch(/SET search_path\s*=\s*public/);
    expect(claimFunction).toMatch(/workspace_id\s*=\s*p_workspace_id/);
    expect(claimFunction).toMatch(/FOR UPDATE/);
    expect(claimFunction).toMatch(/RETURN NEXT/);
    expect(claimFunction).not.toMatch(/v_claim_lease_until\s*<=\s*now\(\)/);
    expect(claimFunction).not.toMatch(/v_claim_attempt_id\s*=\s*p_attempt_id/);
  });

  test('fences finalization by workspace, item, attempt and publishing status', () => {
    const finalizeFunction = migration.match(
      /CREATE OR REPLACE FUNCTION finalize_post_item_claim[\s\S]*?\$\$;/
    )?.[0];

    expect(finalizeFunction).toBeDefined();
    expect(finalizeFunction).toMatch(/SECURITY DEFINER/);
    expect(finalizeFunction).toMatch(/SET search_path\s*=\s*public/);
    expect(finalizeFunction).toMatch(/workspace_id\s*=\s*p_workspace_id/);
    expect(finalizeFunction).toMatch(/publish_claim_attempt_id\s*=\s*p_attempt_id/);
    expect(finalizeFunction).toMatch(/status\s*=\s*'publishing'/);
  });

  test('does not define writer bundle materialization before writer tables exist', () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION materialize_writer_bundle/);
    expect(migration).toMatch(/migration 022/i);
  });
});
