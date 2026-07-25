// Migrations-STOP-Gate (Plan 2 §9): Migration 017 liegt bereit, ist aber NICHT
// angewendet. Bis dahin muss der Code sich so verhalten wie nach dem Vorfall
// vom 2026-07-22 gelernt (Commit 4c347b7): Lesepfade degradieren zu leeren
// Listen, Schreibpfade liefern ein klares 503 `migration_pending` statt eines
// undurchsichtigen 500ers.
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/http';

const missingTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.content_items' in the schema cache",
};

function missingTableChain(): Record<string, unknown> {
  const result = Promise.resolve({ data: null, error: missingTableError });
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select', 'eq', 'in', 'is', 'lt', 'or', 'not', 'order', 'limit',
    'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle', 'returns',
  ]) {
    chain[method] = () => Object.assign(result, chain);
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({
      from: () => missingTableChain(),
      rpc: () => Promise.resolve({ data: null, error: missingTableError }),
    }),
  };
});

import {
  createContentItem,
  getContentItem,
  listContentItems,
  listTransitions,
  listVariants,
  recordGateOverride,
  upsertVariant,
  EMPTY_EVIDENCE,
} from '@/lib/pipeline/state';

function isMigrationPending(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && error.code === 'migration_pending';
}

describe('Lesepfade degradieren, statt die Seite zu crashen', () => {
  test('die Werkstück-Liste ist leer statt zu werfen', async () => {
    await expect(listContentItems('ws-1')).resolves.toEqual([]);
  });

  test('ein einzelnes Werkstück ist null statt zu werfen', async () => {
    await expect(getContentItem('ws-1', 'item-1')).resolves.toBeNull();
  });

  test('Varianten und Protokoll sind leer statt zu werfen', async () => {
    await expect(listVariants('ws-1', 'item-1')).resolves.toEqual([]);
    await expect(listTransitions('ws-1', 'item-1')).resolves.toEqual([]);
  });
});

describe('Schreibpfade liefern 503 migration_pending', () => {
  test('ein Werkstück anlegen', async () => {
    await expect(
      createContentItem('ws-1', {
        signalRef: 'sig-1',
        signalKind: 'feedback_theme',
        title: 'Onboarding-Verwirrung',
        strength: 0.8,
        evidence: EMPTY_EVIDENCE,
        mixBucket: 'insight',
        staleAfter: null,
        reason: 'Signal übernommen',
        actor: 'system',
      })
    ).rejects.toSatisfy(isMigrationPending);
  });

  test('eine Variante speichern', async () => {
    await expect(
      upsertVariant('ws-1', {
        contentItemId: 'item-1',
        channelKey: 'conn-1',
        platform: 'linkedin',
        connectionId: 'conn-1',
        format: 'post',
        content: 'Text',
        segments: [],
        structure: null,
        proofAssetIds: [],
      })
    ).rejects.toSatisfy(isMigrationPending);
  });

  test('ein Übersteuern protokollieren', async () => {
    await expect(
      recordGateOverride('ws-1', {
        variantId: 'var-1',
        contentItemId: 'item-1',
        overriddenBy: 'user-1',
        reason: 'Zahl stammt aus dem Jahresbericht, Beleg wird nachgetragen.',
      })
    ).rejects.toSatisfy(isMigrationPending);
  });
});

describe('Übersteuern ohne Protokoll ist unmöglich (D1)', () => {
  test('ohne Grund wird abgelehnt — noch bevor die Datenbank gefragt wird', async () => {
    await expect(
      recordGateOverride('ws-1', {
        variantId: 'var-1',
        contentItemId: 'item-1',
        overriddenBy: 'user-1',
        reason: '   ',
      })
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'override_reason_required'
    );
  });

  test('ohne benannten Verursacher wird abgelehnt', async () => {
    await expect(
      recordGateOverride('ws-1', {
        variantId: 'var-1',
        contentItemId: 'item-1',
        overriddenBy: '',
        reason: 'Ein triftiger Grund.',
      })
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'override_actor_required'
    );
  });

  test('ein Werkstück ohne Grund entsteht gar nicht erst', async () => {
    await expect(
      createContentItem('ws-1', {
        signalRef: 'sig-2',
        signalKind: 'unused_proof',
        title: 'Ungenutzter Beleg',
        strength: 0.5,
        evidence: EMPTY_EVIDENCE,
        mixBucket: 'proof',
        staleAfter: null,
        reason: '',
        actor: 'system',
      })
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'transition_reason_required'
    );
  });
});
