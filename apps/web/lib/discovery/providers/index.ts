// Discovery-provider factory: turns "this workspace, this platform" into a
// DiscoveryProvider (Vertrag C2) or into an actionable reason why not.
//
// The whole point of the split is that adding a platform is a registry entry
// plus a client module. Nothing here knows what a subreddit or a hashtag is;
// it only knows how each provider gains access — nothing (public API), a stored
// key pair, or an existing publishing connection.

import { ApiError } from '@/lib/api/http';
import { isIntegrationProvider, type IntegrationProvider } from '@/lib/integrations/types';
import { resolveCredential } from '@/lib/integrations/credentials';
import { getRedditClientForWorkspace } from '@/lib/integrations/reddit-credentials';
import {
  DEFAULT_MASTODON_INSTANCES,
  getProviderDescriptor,
  listDiscoveryDescriptors,
  type DiscoveryProvider,
} from '@/lib/integrations/registry';
import { RedditDiscoveryProvider } from './reddit-provider';
import { MastodonDiscoveryProvider } from './mastodon-provider';
import { HackerNewsDiscoveryProvider } from './hackernews-provider';
import { createBlueskyDiscoveryProvider, getBlueskyDiscoveryStatus } from './bluesky-provider';

export interface DiscoveryProviderStatus {
  provider: IntegrationProvider;
  label: string;
  credentialKind: 'none' | 'api_key' | 'reuse_connection';
  available: boolean;
  /** Machine-readable blocker; the UI maps it to copy and never parses prose. */
  reason: 'connect_reddit_first' | 'connect_bluesky_first' | null;
  /** Where the user resolves `reason` inside Prolora. */
  deepLink: string | null;
}

/** Narrows a `discovery_communities.platform` value to a known provider. */
export function toDiscoveryProvider(platform: string): IntegrationProvider | null {
  if (!isIntegrationProvider(platform)) return null;
  return getProviderDescriptor(platform).discovery ? platform : null;
}

export async function getDiscoveryProvider(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<DiscoveryProvider> {
  switch (provider) {
    case 'reddit':
      return new RedditDiscoveryProvider(await getRedditClientForWorkspace(workspaceId));
    case 'mastodon':
      return new MastodonDiscoveryProvider(await resolveMastodonInstances(workspaceId));
    case 'hackernews':
      return new HackerNewsDiscoveryProvider();
    case 'bluesky':
      return createBlueskyDiscoveryProvider(workspaceId);
    default:
      throw new ApiError(
        400,
        `"${provider}" is not a discovery provider.`,
        'provider_not_discoverable'
      );
  }
}

/** Same lookup as above, as a status instead of an exception. */
export async function getDiscoveryProviderStatus(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<DiscoveryProviderStatus> {
  const descriptor = getProviderDescriptor(provider);
  const base = {
    provider,
    label: descriptor.label,
    credentialKind: descriptor.credentialKind,
  };

  // credentialKind 'none' is available by construction — that is the promise.
  if (descriptor.credentialKind === 'none') {
    return { ...base, available: true, reason: null, deepLink: null };
  }

  if (provider === 'bluesky') {
    const status = await getBlueskyDiscoveryStatus(workspaceId);
    return {
      ...base,
      available: status.connected,
      reason: status.connected ? null : 'connect_bluesky_first',
      deepLink: status.connected ? null : status.deepLink,
    };
  }

  if (provider === 'reddit') {
    const resolved = await resolveCredential(workspaceId, 'reddit');
    const connected = Boolean(resolved?.credential.clientId && resolved.credential.clientSecret);
    return {
      ...base,
      available: connected,
      reason: connected ? null : 'connect_reddit_first',
      deepLink: connected ? null : '/settings',
    };
  }

  return { ...base, available: false, reason: null, deepLink: null };
}

/** Every discovery provider with its current availability, picker order kept. */
export function listDiscoveryProviderStatuses(
  workspaceId: string
): Promise<DiscoveryProviderStatus[]> {
  return Promise.all(
    listDiscoveryDescriptors().map((descriptor) =>
      getDiscoveryProviderStatus(workspaceId, descriptor.id)
    )
  );
}

export async function listAvailableDiscoveryProviders(
  workspaceId: string
): Promise<IntegrationProvider[]> {
  const statuses = await listDiscoveryProviderStatuses(workspaceId);
  return statuses.filter((status) => status.available).map((status) => status.provider);
}

/**
 * A workspace may pin which instances to sweep (stored as a comma-separated
 * list in the `mastodon` credential row). Empty stays empty: the default list
 * is the honest answer, not an error.
 */
async function resolveMastodonInstances(workspaceId: string): Promise<readonly string[]> {
  const resolved = await resolveCredential(workspaceId, 'mastodon');
  const raw = resolved?.credential.instances ?? '';
  const pinned = raw
    .split(',')
    .map((host) => host.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
    .filter(Boolean);
  return pinned.length > 0 ? pinned : DEFAULT_MASTODON_INSTANCES;
}
