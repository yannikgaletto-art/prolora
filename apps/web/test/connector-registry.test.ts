import { describe, expect, it } from 'vitest';
import { CONNECTION_REGISTRY } from '../lib/connections/registry';

describe('connection registry', () => {
  it('shows at least twenty unique channels in four honest states', () => {
    expect(CONNECTION_REGISTRY.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CONNECTION_REGISTRY.map((connector) => connector.id)).size).toBe(CONNECTION_REGISTRY.length);
    expect(new Set(CONNECTION_REGISTRY.map((connector) => connector.availability))).toEqual(
      new Set(['available', 'setup_required', 'coming_soon', 'manual_assist'])
    );
  });

  it('only labels implemented API channels as available', () => {
    const available = CONNECTION_REGISTRY
      .filter((connector) => connector.availability === 'available')
      .map((connector) => connector.id);
    expect(available).toEqual(expect.arrayContaining(['bluesky', 'mastodon', 'telegram', 'discord', 'devto', 'hashnode']));
    expect(available).not.toEqual(expect.arrayContaining(['threads', 'instagram', 'medium']));
  });

  it('declares the complete connect flow in each descriptor', () => {
    for (const connector of CONNECTION_REGISTRY) {
      expect(connector.connectFlow).toBeTruthy();
      if (connector.connectFlow === 'credential') {
        expect(connector.credentialForm?.secretLabel).toBeTruthy();
      }
    }
    expect(CONNECTION_REGISTRY.filter((item) => item.authKind === 'api_key').every((item) => item.connectFlow === 'credential')).toBe(true);
  });
});
