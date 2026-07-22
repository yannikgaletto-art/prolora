// The download route's only access control is isWorkspaceMediaKey — a foreign
// or malformed key must never reach Storage (Invariante 2). Pin every branch.
import { describe, expect, it } from 'vitest';
import { downloadFilename, isWorkspaceMediaKey } from '@/lib/media/library';

const WS = 'a2c8e5c0-1234-4abc-9def-000000000001';
const KEY = `workspaces/${WS}/media/b7f3d9e1-5678-4abc-9def-000000000002/original.jpg`;

describe('isWorkspaceMediaKey', () => {
  it('accepts a well-formed key of the own workspace', () => {
    expect(isWorkspaceMediaKey(WS, KEY)).toBe(true);
  });

  it('rejects keys of other workspaces', () => {
    expect(isWorkspaceMediaKey('other-workspace', KEY)).toBe(false);
  });

  it('rejects prefix-tricks: a workspace id that only starts like ours', () => {
    // startsWith alone would pass 'workspaces/<ws>-evil/...' for workspace '<ws>-evil'
    // — but must fail for ours.
    expect(isWorkspaceMediaKey(WS, `workspaces/${WS}-evil/media/x/original.jpg`)).toBe(false);
  });

  it('rejects traversal, empty segments and wrong depth', () => {
    expect(isWorkspaceMediaKey(WS, `workspaces/${WS}/media/../secrets.txt`)).toBe(false);
    expect(isWorkspaceMediaKey(WS, `workspaces/${WS}/media//original.jpg`)).toBe(false);
    expect(isWorkspaceMediaKey(WS, `workspaces/${WS}/media/original.jpg`)).toBe(false);
    expect(isWorkspaceMediaKey(WS, `workspaces/${WS}/media/a/b/original.jpg`)).toBe(false);
    expect(isWorkspaceMediaKey(WS, '')).toBe(false);
    expect(isWorkspaceMediaKey('', 'workspaces//media/a/original.jpg')).toBe(false);
  });
});

describe('downloadFilename', () => {
  it('builds prolora-<uuid-prefix>.<ext> from the key', () => {
    expect(downloadFilename(KEY)).toBe('prolora-b7f3d9e1.jpg');
  });

  it('falls back to .bin without an extension', () => {
    expect(downloadFilename(`workspaces/${WS}/media/b7f3d9e1/original`)).toBe('prolora-b7f3d9e1.bin');
  });
});
