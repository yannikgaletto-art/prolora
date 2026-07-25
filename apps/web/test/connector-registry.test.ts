import { describe, expect, it } from 'vitest';
import {
  CONNECTION_REGISTRY,
  CONNECTOR_CATEGORY_ORDER,
  groupConnectorsByAvailability,
} from '../lib/connections/registry';

describe('connection registry', () => {
  it('shows at least twenty unique channels in four honest states', () => {
    expect(CONNECTION_REGISTRY.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CONNECTION_REGISTRY.map((connector) => connector.id)).size).toBe(CONNECTION_REGISTRY.length);
    expect(new Set(CONNECTION_REGISTRY.map((connector) => connector.availability))).toEqual(
      new Set(['available', 'oauth_byo', 'coming_soon', 'manual_assist'])
    );
  });

  // The dead end this replaced: LinkedIn and X told the reader that "the
  // operator" had to act, while the reader owned the developer app.
  it('routes LinkedIn and X through bring-your-own OAuth with a usable console link', () => {
    for (const id of ['linkedin', 'x']) {
      const connector = CONNECTION_REGISTRY.find((item) => item.id === id);
      expect(connector?.availability).toBe('oauth_byo');
      expect(connector?.connectFlow).toBe('oauth_byo');
      expect(connector?.oauthApp?.consoleUrl).toMatch(/^https:\/\//);
      expect(connector?.oauthApp?.scopes.length).toBeGreaterThan(0);
      expect(connector?.description).not.toMatch(/operator/i);
    }
  });

  it('groups every channel into exactly one visible category', () => {
    const groups = groupConnectorsByAvailability();
    expect(groups.map((group) => group.availability)).toEqual([...CONNECTOR_CATEGORY_ORDER]);
    expect(groups.reduce((sum, group) => sum + group.connectors.length, 0)).toBe(
      CONNECTION_REGISTRY.length
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
