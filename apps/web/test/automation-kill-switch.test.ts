import { beforeEach, describe, expect, test, vi } from 'vitest';

// The switch guards real spending, so the tests are about the failure paths:
// every way of *not knowing* the answer has to read as "disabled".
const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    isMissingSchemaError: actual.isMissingSchemaError,
    getServiceDb: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
        upsert: mocks.upsert,
      }),
    }),
  };
});

import { isAutomationEnabled, setAutomationEnabled } from '@/lib/system/kill-switch';

describe('isAutomationEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  test('reports enabled only when the row explicitly says so', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { automation_enabled: true }, error: null });
    expect(await isAutomationEnabled()).toBe(true);

    mocks.maybeSingle.mockResolvedValue({ data: { automation_enabled: false }, error: null });
    expect(await isAutomationEnabled()).toBe(false);
  });

  // Deploy-before-migrate is the normal order here, so the window where the
  // code exists and the table does not must stop jobs, not throw at the top of
  // every Inngest handler and turn into a retry storm.
  test('stops automation when Migration 024 is not applied yet', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '42P01', message: 'relation "system_settings" does not exist' },
    });
    await expect(isAutomationEnabled()).resolves.toBe(false);
  });

  test('stops automation when the row is missing', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await isAutomationEnabled()).toBe(false);
  });

  test('stops automation when the database is unreachable', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });
    await expect(isAutomationEnabled()).resolves.toBe(false);
  });
});

describe('setAutomationEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  test('surfaces a failed flip instead of reporting success', async () => {
    mocks.upsert.mockResolvedValue({ error: { code: '08006', message: 'connection failure' } });
    await expect(setAutomationEnabled(true)).rejects.toThrow(/connection failure/);
  });

  test('names the pending migration when the table is missing', async () => {
    mocks.upsert.mockResolvedValue({
      error: { code: '42P01', message: 'relation "system_settings" does not exist' },
    });
    await expect(setAutomationEnabled(true)).rejects.toThrow(/Migration 024/);
  });
});
