// Declarative provider descriptors + the discovery-provider contract (C2).
//
// Two things live here that used to be scattered:
//
//  1. Everything the UI needs to render a provider — label, what kind of
//     credential it wants, which form fields that implies, the setup walk-
//     through, the deep link. `ConnectRedditPanel` hard-coded Reddit's
//     three-step instruction in JSX, which meant every further provider needed
//     its own panel. Rendering from a descriptor makes "a new provider" one
//     registry entry plus one client module, with no new UI.
//
//  2. `DiscoveryProvider` — the interface the discovery core talks to instead of
//     `RedditClient`. Kept next to the descriptors because `capabilities` is
//     shared by both: the UI has to be honest about what a provider can do
//     (Hacker News has no communities) and the core has to branch on it.
//
// No runtime imports beyond the type module on purpose: this file is imported by
// client components *and* by server-side provider implementations. Data + types
// only, so it never drags server code into the browser bundle.

import type { IntegrationProvider } from './types';

// --- Descriptors (UI) -------------------------------------------------------

/**
 * How a workspace gains access to a provider.
 *  - `none`             — public API, usable from second one. Nothing to enter.
 *  - `api_key`          — the user registers an app and pastes the pair.
 *  - `reuse_connection` — reuses a credential already stored for publishing.
 */
export type CredentialKind = 'none' | 'api_key' | 'reuse_connection';

export interface CredentialFieldDescriptor {
  /** Key inside `StoredCredential` — also the request-body field name. */
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  hint?: string;
  minLength: number;
  maxLength: number;
}

/**
 * One line of the setup walk-through. Split into parts rather than shipping
 * markup so the renderer stays a plain component and the copy stays data.
 */
export interface ProviderSetupStep {
  text: string;
  link?: { label: string; url: string };
  textAfter?: string;
  /**
   * Renders a copy-to-clipboard field. `app_origin` is resolved in the browser:
   * Reddit's form demands a redirect URI even for app-only access, and the app's
   * own origin is a real URL that satisfies it without implying a callback.
   */
  copyValue?: 'app_origin';
  note?: string;
}

export interface DiscoveryCapabilities {
  /** Provider has real, addressable communities (subreddits) — not topic queries. */
  findCommunities: boolean;
  /** Provider exposes machine-readable community rules. */
  readRules: boolean;
  /** Provider can be scanned for threads/opportunities. */
  scanThreads: boolean;
}

export interface ProviderDescriptor {
  id: IntegrationProvider;
  label: string;
  /** Badge tone from the shared colour vocabulary (app/components/Badge). */
  tone: 'green' | 'amber' | 'gray' | 'teal' | 'blue' | 'red';
  credentialKind: CredentialKind;
  /** One line for the picker — what this provider gets you. */
  summary: string;
  /** Participates in the Discover flow (as opposed to publishing-only apps). */
  discovery: boolean;
  capabilities: DiscoveryCapabilities;
  /**
   * The uncomfortable truth about this provider, shown in the UI verbatim.
   * Hiding it would make the picker promise something the provider cannot do.
   */
  caveat?: string;
  /** Where the user registers the app (deep link out of Prolora). */
  setupUrl?: string;
  /** Where the user goes inside Prolora when `credentialKind` is reuse_connection. */
  connectDeepLink?: string;
  setupSteps: ProviderSetupStep[];
  fields: CredentialFieldDescriptor[];
  /** Honest expectation setting on the connect button. */
  setupTimeHint?: string;
  connectCta: string;
  /** Providers usable without any user input rank first in the picker. */
  order: number;
  /**
   * Noise floor for candidates, in this provider's own unit. Reddit counts
   * subscribers (thousands), a Mastodon hashtag counts posting accounts
   * (dozens) — one global threshold would silently delete every non-Reddit
   * result, so the number belongs to the provider.
   */
  discoveryMinMembers: number;
}

const NO_CAPABILITIES: DiscoveryCapabilities = {
  findCommunities: false,
  readRules: false,
  scanThreads: false,
};

/**
 * Instances queried when a workspace has not pinned its own. Mixed on purpose:
 * two large general servers, two DACH servers, two tech servers — a hashtag
 * sweep that only asked mastodon.social would miss most German-speaking posts.
 */
export const DEFAULT_MASTODON_INSTANCES: readonly string[] = [
  'mastodon.social',
  'chaos.social',
  'troet.cafe',
  'hachyderm.io',
  'fosstodon.org',
  'mastodon.online',
];

export const PROVIDER_DESCRIPTORS: Record<IntegrationProvider, ProviderDescriptor> = {
  mastodon: {
    id: 'mastodon',
    label: 'Mastodon',
    tone: 'teal',
    credentialKind: 'none',
    summary: 'Hashtag communities across the fediverse. Public API — nothing to register.',
    discovery: true,
    capabilities: { findCommunities: true, readRules: false, scanThreads: true },
    caveat:
      'Mastodon instances publish no machine-readable rules, so posting policies are not evaluated.',
    setupSteps: [],
    fields: [],
    connectCta: 'Use Mastodon',
    order: 0,
    discoveryMinMembers: 3,
  },

  hackernews: {
    id: 'hackernews',
    label: 'Hacker News',
    tone: 'amber',
    credentialKind: 'none',
    summary: 'Topic queries over the full HN archive. Free Algolia API — no key.',
    discovery: true,
    // Honest flags: HN has no communities at all, so what Prolora stores are
    // saved topic queries. Marking findCommunities false is what lets the UI
    // say so instead of pretending r/-style membership numbers exist.
    capabilities: { findCommunities: false, readRules: false, scanThreads: true },
    caveat: 'Hacker News has no communities, only topics — Prolora tracks saved topic queries.',
    setupSteps: [],
    fields: [],
    connectCta: 'Use Hacker News',
    order: 1,
    discoveryMinMembers: 1,
  },

  reddit: {
    id: 'reddit',
    label: 'Reddit',
    tone: 'blue',
    credentialKind: 'api_key',
    summary: 'Subreddits with member counts and posting rules. Needs your own Reddit app.',
    discovery: true,
    capabilities: { findCommunities: true, readRules: true, scanThreads: true },
    setupUrl: 'https://www.reddit.com/prefs/apps',
    setupTimeHint: 'about a minute',
    setupSteps: [
      {
        text: 'Open',
        link: { label: 'reddit.com/prefs/apps', url: 'https://www.reddit.com/prefs/apps' },
        textAfter: 'and choose "create another app…"',
      },
      {
        text: 'Pick type script, give it any name, and paste this as the redirect URI:',
        copyValue: 'app_origin',
        note:
          'Prolora only reads public Reddit data and never posts, so nothing ever redirects here — Reddit just requires the field to be filled.',
      },
      {
        text: 'Copy the ID under the app name and the secret into the fields below.',
      },
    ],
    fields: [
      {
        name: 'clientId',
        label: 'Client ID',
        type: 'text',
        placeholder: 'e.g. Ab3dEfGh1JkLmN',
        minLength: 8,
        maxLength: 128,
      },
      {
        name: 'clientSecret',
        label: 'Client secret',
        type: 'password',
        hint: 'Stored encrypted (AES-256-GCM). It is never shown again after saving.',
        minLength: 8,
        maxLength: 256,
      },
    ],
    connectCta: 'Connect Reddit',
    order: 2,
    discoveryMinMembers: 1000,
  },

  bluesky: {
    id: 'bluesky',
    label: 'Bluesky',
    tone: 'blue',
    credentialKind: 'reuse_connection',
    summary: 'Searches Bluesky with the app password you already connected for publishing.',
    discovery: true,
    capabilities: { findCommunities: false, readRules: false, scanThreads: true },
    caveat: 'Bluesky has no communities — Prolora tracks saved topic searches.',
    connectDeepLink: '/connections',
    setupSteps: [
      {
        text: 'Connect your Bluesky account once under Channels — discovery reuses that app password.',
      },
    ],
    fields: [],
    connectCta: 'Open Channels',
    order: 3,
    discoveryMinMembers: 1,
  },

  linkedin_app: {
    id: 'linkedin_app',
    label: 'LinkedIn app',
    tone: 'blue',
    credentialKind: 'api_key',
    summary: 'Your own LinkedIn developer app, used for publishing connections.',
    discovery: false,
    capabilities: NO_CAPABILITIES,
    setupUrl: 'https://www.linkedin.com/developers/apps',
    setupSteps: [
      {
        text: 'Create an app at',
        link: { label: 'linkedin.com/developers/apps', url: 'https://www.linkedin.com/developers/apps' },
        textAfter: 'and request the "Share on LinkedIn" and "Sign In with LinkedIn" products.',
      },
      {
        text: 'Add this redirect URL to the app\'s Auth tab:',
        copyValue: 'app_origin',
      },
      { text: 'Copy the client ID and client secret into the fields below.' },
    ],
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text', minLength: 6, maxLength: 128 },
      {
        name: 'clientSecret',
        label: 'Client secret',
        type: 'password',
        hint: 'Stored encrypted (AES-256-GCM).',
        minLength: 6,
        maxLength: 256,
      },
    ],
    connectCta: 'Save LinkedIn app',
    order: 4,
    discoveryMinMembers: 0,
  },

  x_app: {
    id: 'x_app',
    label: 'X app',
    tone: 'gray',
    credentialKind: 'api_key',
    summary: 'Your own X developer app, used for publishing connections.',
    discovery: false,
    capabilities: NO_CAPABILITIES,
    setupUrl: 'https://developer.x.com/en/portal/dashboard',
    setupSteps: [
      {
        text: 'Create a project + app in the',
        link: { label: 'X developer portal', url: 'https://developer.x.com/en/portal/dashboard' },
        textAfter: 'and enable OAuth 2.0 with "Read and write".',
      },
      { text: 'Add this callback URL:', copyValue: 'app_origin' },
      { text: 'Copy the OAuth 2.0 client ID and client secret into the fields below.' },
    ],
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text', minLength: 6, maxLength: 128 },
      {
        name: 'clientSecret',
        label: 'Client secret',
        type: 'password',
        hint: 'Stored encrypted (AES-256-GCM).',
        minLength: 6,
        maxLength: 256,
      },
    ],
    connectCta: 'Save X app',
    order: 5,
    discoveryMinMembers: 0,
  },
};

export function getProviderDescriptor(provider: IntegrationProvider): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[provider];
}

/** Discovery providers, credential-free ones first (see `order`). */
export function listDiscoveryDescriptors(): ProviderDescriptor[] {
  return Object.values(PROVIDER_DESCRIPTORS)
    .filter((descriptor) => descriptor.discovery)
    .sort((a, b) => a.order - b.order);
}

/**
 * Descriptor -> form. The form is derived, never hand-written: a provider whose
 * access needs no input must not render an input, or the UI would ask for
 * something the backend will refuse to store.
 */
export function credentialFieldsFor(
  descriptor: ProviderDescriptor
): CredentialFieldDescriptor[] {
  return descriptor.credentialKind === 'api_key' ? descriptor.fields : [];
}

export function requiresCredentialForm(descriptor: ProviderDescriptor): boolean {
  return credentialFieldsFor(descriptor).length > 0;
}

/** True when a workspace can use the provider without entering anything. */
export function isSelfServing(descriptor: ProviderDescriptor): boolean {
  return descriptor.credentialKind === 'none';
}

// --- Vertrag C2: the discovery-provider contract ----------------------------

export interface DiscoveredCommunityCandidate {
  /**
   * Provider-native, stable identity: subreddit name, hashtag, HN/Bluesky query.
   * Written to `discovery_communities.community_external_id` (migration 015) and
   * used as the dedupe key across providers.
   */
  externalId: string;
  /** Display name, already provider-prefixed ("r/saas", "#buildinpublic"). */
  name: string;
  url: string;
  description: string;
  /** Members, followers, or matched documents — provider-defined magnitude. */
  memberCount: number;
  activeCount: number | null;
  language: string | null;
  nsfw: boolean;
  /**
   * True when this is a saved topic query rather than a real community
   * (Hacker News, Bluesky). Kept on the candidate so the UI and the LLM prompt
   * can both stop describing it as a place with members and rules.
   */
  isTopicQuery: boolean;
}

export interface CommunityRule {
  shortName: string;
  description: string;
}

export interface DiscoveredThread {
  /** Stable per-provider id — written to `opportunity_threads.thread_external_id`. */
  externalId: string;
  title: string;
  body: string;
  author: string;
  communityName: string;
  url: string;
  /** Unix seconds. */
  createdAt: number;
  score: number;
  replies: number;
}

export interface ThreadSearchOptions {
  time?: 'hour' | 'day' | 'week';
  limit?: number;
}

/** One partial failure inside an otherwise successful call. */
export interface ProviderDegradation {
  /** Instance host, endpoint, or query that failed. */
  source: string;
  reason: string;
}

export interface DiscoveryProvider {
  readonly id: IntegrationProvider;
  readonly capabilities: DiscoveryCapabilities;

  searchCommunities(topics: string[], limit: number): Promise<DiscoveredCommunityCandidate[]>;

  /**
   * `null` means "this provider has no rules API" — NOT an error. A provider
   * without `capabilities.readRules` returns null and never throws, and the
   * caller skips the rules part of the evaluation instead of dropping the whole
   * community.
   */
  getCommunityRules(externalId: string): Promise<CommunityRule[] | null>;

  searchThreads(
    externalId: string,
    query: string,
    opts: ThreadSearchOptions
  ): Promise<DiscoveredThread[]>;

  getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]>;

  /**
   * Optional liveness/refresh probe for the health check. `null` = the provider
   * cannot answer "is this still there and how big is it" cheaply; the caller
   * then falls back to a thread fetch as the liveness signal.
   */
  getCommunityInfo?(externalId: string): Promise<DiscoveredCommunityCandidate | null>;

  /**
   * Partial failures collected during the calls above. Present on providers that
   * fan out (Mastodon instances, HN pagination) — a dead instance degrades the
   * result instead of failing the run, and this is where that is recorded.
   */
  readonly degradations?: ProviderDegradation[];
}
