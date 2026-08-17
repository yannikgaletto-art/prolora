import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/http';
import {
  buildWriterReviewSnapshot,
  canApproveWriterReview,
  validateWriterApproval,
  type WriterReviewBundleRow,
  type WriterReviewSnapshotInput,
} from '@/lib/writer/reviews';
import { sha256Hex } from '@/lib/writer/hash';

const migration = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/022_writer_pilot.sql'),
  'utf8'
);

const snapshotInput: WriterReviewSnapshotInput = {
  contentItem: {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'A grounded Writer post',
    canonicalContent: 'Canonical source copy.',
  },
  variants: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      channelKey: 'connection-b',
      platform: 'x',
      connection: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        platform: 'x',
        accountId: 'account-b',
        accountName: 'Account B',
      },
      format: 'post',
      content: 'Exact X copy.',
      segments: [],
      media: [],
      firstComment: null,
      proofAssetIds: [],
      gatePassed: true,
      gateResult: { hardFailures: [] },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      channelKey: 'connection-a',
      platform: 'linkedin',
      connection: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        platform: 'linkedin',
        accountId: 'account-a',
        accountName: 'Account A',
      },
      format: 'post',
      content: 'Exact LinkedIn copy.',
      segments: [],
      media: [
        {
          storageKey: 'writer/media.png',
          mimeType: 'image/png',
          altText: 'A descriptive alt text',
          contentHash: 'f'.repeat(64),
        },
      ],
      firstComment: 'Exact first comment.',
      proofAssetIds: ['44444444-4444-4444-8444-444444444444'],
      gatePassed: true,
      gateResult: { hardFailures: [] },
    },
  ],
  proposedSlot: {
    scheduledAt: '2026-08-01T08:00:00.000Z',
    timezone: 'Europe/Berlin',
  },
  sources: {
    proofAssets: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        consentStatus: 'granted',
        verifiedAt: '2026-07-29T12:00:00.000Z',
        contentHash: sha256Hex('Original proof content.'),
      },
    ],
    feedbackItemIds: ['55555555-5555-4555-8555-555555555555'],
    feedbackItems: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        contentHash: sha256Hex('Original feedback content.'),
      },
    ],
    referenceIds: ['88888888-8888-4888-8888-888888888888'],
    references: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        contentHash: sha256Hex('Original reusable pattern.'),
        verifiedAt: '2026-07-28T12:00:00.000Z',
      },
    ],
  },
  dna: {
    profileId: '66666666-6666-4666-8666-666666666666',
    version: 3,
  },
  versions: {
    prompt: 'writer-v1',
    promptHash: sha256Hex(
      [
        '66666666-6666-4666-8666-666666666666',
        '3',
        'writer-v1',
        'sample-set-hash',
      ].join(':')
    ),
    gate: 'gate-v1',
    policy: 2,
  },
};

function reviewRow(): WriterReviewBundleRow {
  const built = buildWriterReviewSnapshot(snapshotInput);
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: 'workspace-1',
    content_item_id: snapshotInput.contentItem.id,
    status: 'pending',
    snapshot: built.snapshot,
    snapshot_hash: built.snapshotHash,
    variant_hashes: built.variantHashes,
    source_set_hash: built.sourceSetHash,
    dna_profile_id: snapshotInput.dna.profileId,
    dna_version: snapshotInput.dna.version,
    prompt_version: snapshotInput.versions.prompt,
    gate_version: snapshotInput.versions.gate,
    policy_version: snapshotInput.versions.policy,
    expires_at: '2026-08-02T08:00:00.000Z',
    approved_by: null,
    approved_role: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    superseded_by: null,
    created_at: '2026-07-30T12:00:00.000Z',
  };
}

describe('immutable Writer review snapshots', () => {
  test('canonicalizes semantically unordered variants and source ids', () => {
    const first = buildWriterReviewSnapshot(snapshotInput);
    const second = buildWriterReviewSnapshot({
      ...snapshotInput,
      variants: [...snapshotInput.variants].reverse(),
      sources: {
        ...snapshotInput.sources,
        feedbackItemIds: [...snapshotInput.sources.feedbackItemIds].reverse(),
      },
    });

    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.snapshot.variants.map((variant) => variant.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(first.variantHashes).toMatchObject({
      '22222222-2222-4222-8222-222222222222': expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(first.sourceSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('binds destinations, consent, versions, slot and media metadata', () => {
    const { snapshot } = buildWriterReviewSnapshot(snapshotInput);
    expect(snapshot.variants[0]).toMatchObject({
      connection: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      media: [{ storageKey: 'writer/media.png', contentHash: 'f'.repeat(64) }],
    });
    expect(snapshot.sources.proofAssets[0]).toMatchObject({ consentStatus: 'granted' });
    expect(snapshot.sources.feedbackItems[0]).toMatchObject({
      id: '55555555-5555-4555-8555-555555555555',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(snapshot.sources.references[0]).toMatchObject({
      id: '88888888-8888-4888-8888-888888888888',
      verifiedAt: '2026-07-28T12:00:00.000Z',
    });
    expect(snapshot.proposedSlot.timezone).toBe('Europe/Berlin');
    expect(snapshot.dna.version).toBe(3);
    expect(snapshot.versions).toMatchObject({
      prompt: 'writer-v1',
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      gate: 'gate-v1',
      policy: 2,
    });
  });
});

describe('Writer approval validation', () => {
  const connections = snapshotInput.variants.map((variant) => ({
    id: variant.connection.id,
    platform: variant.connection.platform,
    account_id: variant.connection.accountId,
    account_name: variant.connection.accountName,
    status: 'active',
  }));
  const proofs = snapshotInput.sources.proofAssets.map((proof) => ({
    id: proof.id,
    consent_status: proof.consentStatus,
    verified_at: proof.verifiedAt,
    content: 'Original proof content.',
  }));

  // Frozen clock inside the fixture's validity window — without it these
  // tests became time bombs once the hardcoded expires_at (2026-08-02) passed.
  const FROZEN_NOW = new Date('2026-07-31T08:00:00.000Z');

  test.each(['owner', 'admin'] as const)('allows %s approval', (role) => {
    const review = reviewRow();
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role,
        connections,
        proofs,
        now: new Date('2026-07-31T08:00:00.000Z'),
      })
    ).not.toThrow();
  });

  test.each(['member', 'viewer'] as const)('rejects %s approval', (role) => {
    expect(canApproveWriterReview(role)).toBe(false);
    const review = reviewRow();
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role,
        connections,
        proofs,
        now: FROZEN_NOW,
      })
    ).toThrowError(
      expect.objectContaining({ status: 403, code: 'approval_role_required' }) as ApiError
    );
  });

  test('rejects a stale supplied or persisted snapshot hash', () => {
    const review = reviewRow();
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: '0'.repeat(64),
        role: 'admin',
        connections,
        proofs,
        now: FROZEN_NOW,
      })
    ).toThrowError(expect.objectContaining({ status: 409, code: 'stale_review' }) as ApiError);

    review.snapshot = { ...review.snapshot, contentItem: { ...review.snapshot.contentItem, title: 'tampered' } };
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role: 'admin',
        connections,
        proofs,
        now: FROZEN_NOW,
      })
    ).toThrowError(expect.objectContaining({ status: 409, code: 'stale_review' }) as ApiError);
  });

  test('rejects changed destinations or revoked consent', () => {
    const review = reviewRow();
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role: 'owner',
        connections: [{ ...connections[0], status: 'revoked' }, connections[1]],
        proofs,
        now: FROZEN_NOW,
      })
    ).toThrowError(
      expect.objectContaining({ status: 409, code: 'approval_context_changed' }) as ApiError
    );

    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role: 'owner',
        connections,
        proofs: [{ ...proofs[0], consent_status: 'denied' }],
        now: FROZEN_NOW,
      })
    ).toThrowError(
      expect.objectContaining({ status: 409, code: 'approval_context_changed' }) as ApiError
    );
  });

  test('rejects proof content changed after the immutable review was created', () => {
    const review = reviewRow();
    expect(() =>
      validateWriterApproval({
        review,
        suppliedSnapshotHash: review.snapshot_hash,
        role: 'owner',
        connections,
        proofs: [{ ...proofs[0], content: 'Changed proof content.' }],
        now: FROZEN_NOW,
      })
    ).toThrowError(
      expect.objectContaining({ status: 409, code: 'approval_context_changed' }) as ApiError
    );
  });
});

describe('migration 022 review and materialization contract', () => {
  test('stores one immutable pending snapshot per content item with workspace RLS', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS writer_review_bundles/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_writer_review_pending[\s\S]*?WHERE status = 'pending'/
    );
    expect(migration).toMatch(/guard_writer_review_snapshot_mutation/);
    expect(migration).toMatch(/ALTER TABLE writer_review_bundles ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/CREATE POLICY "writer_review_bundles_read"[\s\S]*?user_workspace_ids\(\)/);
  });

  test('defines a workspace-scoped, locked and idempotent materialization transaction', () => {
    const fn = migration.match(
      /CREATE OR REPLACE FUNCTION materialize_writer_bundle[\s\S]*?\n\$\$;/
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = public/);
    expect(fn).toMatch(/FOR UPDATE/);
    expect(fn).toMatch(/workspace_id = p_workspace_id/);
    expect(fn).toMatch(/snapshot_hash <> p_snapshot_hash/);
    expect(fn).toMatch(/content_item_variant_id/);
    expect(fn).toMatch(/consent_status NOT IN \('not_required', 'granted'\)/);
    expect(fn).toMatch(/RETURN NEXT/);
  });

  test('revalidates immutable DNA, prompt, proof, provenance and media hashes', () => {
    const fn = migration.match(
      /CREATE OR REPLACE FUNCTION materialize_writer_bundle[\s\S]*?\n\$\$;/
    )?.[0];
    expect(fn).toMatch(/content_dna_profiles/);
    expect(fn).toMatch(/dna\.status = 'active'/);
    expect(fn).toMatch(/dna\.version = v_review\.dna_version/);
    expect(fn).toMatch(/promptHash/);
    expect(fn).toMatch(/digest\(proof\.content, 'sha256'\)/);
    expect(fn).toMatch(/proof\.verified_at IS DISTINCT FROM[\s\S]*?verifiedAt/);
    expect(fn).toMatch(/feedbackItems/);
    expect(fn).toMatch(/references/);
    expect(fn).toMatch(/contentHash/);
    expect(fn).toMatch(/variant\.media IS NOT DISTINCT FROM/);
  });

  test('enforces pause, cap, quiet day and destination slot collision under the policy lock', () => {
    const fn = migration.match(
      /CREATE OR REPLACE FUNCTION materialize_writer_bundle[\s\S]*?\n\$\$;/
    )?.[0];
    expect(fn).toMatch(/workspace_writer_policies[\s\S]*?FOR UPDATE/);
    expect(fn).toMatch(/v_policy\.enabled IS NOT TRUE/);
    expect(fn).toMatch(/daily_post_cap/);
    expect(fn).toMatch(/quiet_days/);
    expect(fn).toMatch(/Writer destination slot is already occupied/);
  });

  test('stores each exact channel payload and records the approver in the same transaction', () => {
    expect(migration).toMatch(/ALTER TABLE content_item_variants[\s\S]*?media JSONB/);
    expect(migration).toMatch(/ALTER TABLE post_items[\s\S]*?content_format TEXT/);
    expect(migration).toMatch(/ALTER TABLE post_items[\s\S]*?content_segments JSONB/);
    const fn = migration.match(
      /CREATE OR REPLACE FUNCTION materialize_writer_bundle[\s\S]*?\n\$\$;/
    )?.[0];
    expect(fn).toMatch(/p_approver_id UUID/);
    expect(fn).toMatch(/p_approver_role TEXT/);
    expect(fn).toMatch(/first_comment[\s\S]*?v_variant ->> 'firstComment'/);
    expect(fn).toMatch(/content_format[\s\S]*?v_variant ->> 'format'/);
    expect(fn).toMatch(/content_segments[\s\S]*?v_variant -> 'segments'/);
    expect(fn).toMatch(/approved_by = p_approver_id/);
    expect(fn).toMatch(/approved_role = p_approver_role/);
    expect(migration).toMatch(/NEW\.approved_role IS DISTINCT FROM OLD\.approved_role/);
  });
});
