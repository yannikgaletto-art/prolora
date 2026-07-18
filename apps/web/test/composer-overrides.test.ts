import { describe, expect, it } from 'vitest';
import { buildConnectionOverrides } from '@/app/(dashboard)/publish/composer-overrides';

describe('buildConnectionOverrides', () => {
  it('submits only selected accounts whose text differs from the master copy', () => {
    const overrides = buildConnectionOverrides({
      masterContent: 'Master copy',
      selectedConnectionIds: new Set(['account-a', 'account-b']),
      contentByConnection: {
        'account-a': 'Founder voice',
        'account-b': 'Master copy',
        'account-c': 'Not selected',
      },
    });

    expect(overrides).toEqual({
      'account-a': { content: 'Founder voice' },
    });
  });

  it('drops empty drafts instead of overriding a valid master copy', () => {
    const overrides = buildConnectionOverrides({
      masterContent: 'Master copy',
      selectedConnectionIds: new Set(['account-a']),
      contentByConnection: { 'account-a': '   ' },
    });

    expect(overrides).toEqual({});
  });
});
