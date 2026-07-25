import { describe, expect, it } from 'vitest';
import {
  PROVIDER_DESCRIPTORS,
  credentialFieldsFor,
  getProviderDescriptor,
  isSelfServing,
  listDiscoveryDescriptors,
  requiresCredentialForm,
  type DiscoveryProvider,
} from '../lib/integrations/registry';
import { INTEGRATION_PROVIDERS } from '../lib/integrations/types';
import { MastodonDiscoveryProvider } from '../lib/discovery/providers/mastodon-provider';
import { HackerNewsDiscoveryProvider } from '../lib/discovery/providers/hackernews-provider';

describe('descriptor -> form derivation', () => {
  it('covers every provider in the credential union', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(getProviderDescriptor(provider).id).toBe(provider);
    }
    expect(Object.keys(PROVIDER_DESCRIPTORS)).toHaveLength(INTEGRATION_PROVIDERS.length);
  });

  it('derives no form for providers that need nothing entered', () => {
    for (const descriptor of Object.values(PROVIDER_DESCRIPTORS)) {
      if (descriptor.credentialKind === 'none' || descriptor.credentialKind === 'reuse_connection') {
        expect(credentialFieldsFor(descriptor)).toEqual([]);
        expect(requiresCredentialForm(descriptor)).toBe(false);
      }
    }
  });

  it('derives a usable form for every api_key provider', () => {
    for (const descriptor of Object.values(PROVIDER_DESCRIPTORS)) {
      if (descriptor.credentialKind !== 'api_key') continue;
      const fields = credentialFieldsFor(descriptor);
      expect(fields.length).toBeGreaterThan(0);
      expect(requiresCredentialForm(descriptor)).toBe(true);
      for (const field of fields) {
        expect(field.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
        expect(field.minLength).toBeGreaterThan(0);
        expect(field.maxLength).toBeGreaterThanOrEqual(field.minLength);
      }
      // Every secret-shaped field must be rendered as a password input.
      const secret = fields.find((field) => /secret/i.test(field.name));
      if (secret) expect(secret.type).toBe('password');
    }
  });

  it('walks the user through app registration instead of hard-coding it in JSX', () => {
    const reddit = getProviderDescriptor('reddit');
    expect(reddit.setupSteps.length).toBeGreaterThanOrEqual(3);
    expect(reddit.setupSteps.some((step) => step.link?.url.includes('reddit.com/prefs/apps'))).toBe(
      true
    );
    // The redirect-URI field is data, not markup — the panel resolves it.
    expect(reddit.setupSteps.some((step) => step.copyValue === 'app_origin')).toBe(true);
  });

  it('points reuse_connection providers at the place that already has the credential', () => {
    const bluesky = getProviderDescriptor('bluesky');
    expect(bluesky.credentialKind).toBe('reuse_connection');
    expect(bluesky.connectDeepLink).toBe('/connections');
  });

  it('ranks the credential-free providers first in the picker', () => {
    const discovery = listDiscoveryDescriptors();
    expect(discovery.length).toBeGreaterThanOrEqual(4);
    const firstTwo = discovery.slice(0, 2);
    expect(firstTwo.every(isSelfServing)).toBe(true);
    expect(firstTwo.map((descriptor) => descriptor.id).sort()).toEqual(['hackernews', 'mastodon']);
  });

  it('states the caveat for providers without real communities', () => {
    for (const descriptor of listDiscoveryDescriptors()) {
      if (descriptor.capabilities.findCommunities) continue;
      expect(descriptor.caveat, `${descriptor.id} must be honest about having no communities`)
        .toBeTruthy();
    }
    expect(getProviderDescriptor('hackernews').caveat).toMatch(/no communities/i);
  });

  it('keeps a per-provider noise floor instead of one global threshold', () => {
    // A single 1000-member floor would silently delete every Mastodon result.
    expect(getProviderDescriptor('reddit').discoveryMinMembers).toBeGreaterThan(
      getProviderDescriptor('mastodon').discoveryMinMembers
    );
  });
});

describe('readRules: false returns null instead of throwing (Vertrag C2)', () => {
  // Typed as the contract, not as the class: that is how the discovery core
  // sees them, and it proves the implementations satisfy C2.
  it('Mastodon has no rules API and says so with null', async () => {
    const provider: DiscoveryProvider = new MastodonDiscoveryProvider(['example.invalid']);
    expect(provider.capabilities.readRules).toBe(false);
    await expect(provider.getCommunityRules('saas')).resolves.toBeNull();
  });

  it('Hacker News has no rules API and says so with null', async () => {
    const provider: DiscoveryProvider = new HackerNewsDiscoveryProvider();
    expect(provider.capabilities.readRules).toBe(false);
    await expect(provider.getCommunityRules('ai agents')).resolves.toBeNull();
  });

  it('capabilities match the descriptor they are rendered from', () => {
    expect(new MastodonDiscoveryProvider().capabilities).toEqual(
      getProviderDescriptor('mastodon').capabilities
    );
    expect(new HackerNewsDiscoveryProvider().capabilities).toEqual(
      getProviderDescriptor('hackernews').capabilities
    );
  });
});
