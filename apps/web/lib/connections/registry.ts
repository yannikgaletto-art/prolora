// GOAL-RUN7 T6: one metadata source drives the picker. A channel is only
// "available" when a real connect + publish path exists in this codebase.
//
// `oauth_byo` replaced `setup_required` for LinkedIn and X: the old label named
// a blocker only the deployment operator could clear, while the person reading
// it was the one who owns the developer app. The flow is still OAuth — the
// workspace supplies the app first (lib/auth/byo-oauth.ts), then redirects.
export type ConnectorAvailability = 'available' | 'oauth_byo' | 'coming_soon' | 'manual_assist';
export type IntegrationKind = 'api' | 'manual_assist';
export type ConnectorFlow =
  | 'oauth'
  | 'oauth_byo'
  | 'mastodon'
  | 'bluesky'
  | 'telegram'
  | 'credential'
  | 'info';

export interface CredentialFormDescriptor {
  description: string;
  secretLabel: string;
  fields?: Array<{ key: string; label: string; placeholder?: string }>;
}

/** Everything ConnectChannelPanel needs to walk a user through their own app. */
export interface OAuthAppDescriptor {
  /** Credential provider key in lib/integrations (workspace-owned app secrets). */
  provider: 'linkedin_app' | 'x_app';
  /** Where the user creates the app. */
  consoleUrl: string;
  consoleLabel: string;
  /** Scopes the app must request — shown so review submissions match. */
  scopes: string[];
}

export interface PlatformConnectorDescriptor {
  id: string;
  label: string;
  initial: string;
  color: string;
  availability: ConnectorAvailability;
  integrationKind: IntegrationKind;
  authKind: 'oauth2' | 'instance_oauth2' | 'app_password' | 'bot_token' | 'webhook_url' | 'api_key' | 'none';
  connectFlow: ConnectorFlow;
  credentialForm?: CredentialFormDescriptor;
  oauthApp?: OAuthAppDescriptor;
  description: string;
  deepLink?: string;
}

export const CONNECTION_REGISTRY: PlatformConnectorDescriptor[] = [
  { id: 'linkedin', label: 'LinkedIn', initial: 'in', color: '#0A66C2', availability: 'oauth_byo', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'oauth_byo', description: 'Connect with your own LinkedIn developer app.', oauthApp: { provider: 'linkedin_app', consoleUrl: 'https://www.linkedin.com/developers/apps/new', consoleLabel: 'linkedin.com/developers', scopes: ['openid', 'profile', 'email', 'w_member_social'] } },
  { id: 'x', label: 'X', initial: 'X', color: '#000000', availability: 'oauth_byo', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'oauth_byo', description: 'Connect with your own X developer app.', oauthApp: { provider: 'x_app', consoleUrl: 'https://developer.x.com/en/portal/dashboard', consoleLabel: 'developer.x.com', scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] } },
  { id: 'bluesky', label: 'Bluesky', initial: 'B', color: '#1185FE', availability: 'available', integrationKind: 'api', authKind: 'app_password', connectFlow: 'bluesky', description: 'Connect with handle and app password.' },
  { id: 'mastodon', label: 'Mastodon', initial: 'M', color: '#6364FF', availability: 'available', integrationKind: 'api', authKind: 'instance_oauth2', connectFlow: 'mastodon', description: 'Connect any public Mastodon instance.' },
  { id: 'telegram', label: 'Telegram', initial: 'T', color: '#26A5E4', availability: 'available', integrationKind: 'api', authKind: 'bot_token', connectFlow: 'telegram', description: 'Connect a bot to a chat or channel.' },
  { id: 'discord', label: 'Discord', initial: 'D', color: '#5865F2', availability: 'available', integrationKind: 'api', authKind: 'webhook_url', connectFlow: 'credential', description: 'Connect a Discord channel webhook.', credentialForm: { description: 'Paste an incoming Discord webhook URL.', secretLabel: 'Webhook URL' } },
  { id: 'devto', label: 'Dev.to', initial: 'DEV', color: '#0A0A0A', availability: 'available', integrationKind: 'api', authKind: 'api_key', connectFlow: 'credential', description: 'Connect a Forem API key.', credentialForm: { description: 'Paste the API key from your Dev.to settings.', secretLabel: 'API key' } },
  { id: 'hashnode', label: 'Hashnode', initial: 'H', color: '#2962FF', availability: 'available', integrationKind: 'api', authKind: 'api_key', connectFlow: 'credential', description: 'Connect a Hashnode personal access token.', credentialForm: { description: 'Paste your Hashnode PAT and publication host. A Pro publication is required for API access.', secretLabel: 'Personal access token', fields: [{ key: 'publication_host', label: 'Publication host', placeholder: 'yourblog.hashnode.dev' }] } },
  { id: 'threads', label: 'Threads', initial: '@', color: '#101010', availability: 'coming_soon', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'info', description: 'Waiting for provider app review.' },
  { id: 'instagram', label: 'Instagram', initial: 'IG', color: '#E1306C', availability: 'coming_soon', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'info', description: 'Waiting for Meta app review.' },
  { id: 'tiktok', label: 'TikTok', initial: 'TT', color: '#111111', availability: 'coming_soon', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'info', description: 'Waiting for provider app review.' },
  { id: 'youtube', label: 'YouTube', initial: 'YT', color: '#FF0000', availability: 'coming_soon', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'info', description: 'Provider connection is in preparation.' },
  { id: 'reddit', label: 'Reddit posting', initial: 'R', color: '#FF4500', availability: 'coming_soon', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'info', description: 'Discovery is read-only; posting is intentionally not enabled yet.' },
  { id: 'producthunt', label: 'Product Hunt', initial: 'P', color: '#DA552F', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Prolora prepares copy and opens the publishing page.', deepLink: 'https://www.producthunt.com/posts/new' },
  { id: 'hackernews', label: 'Hacker News', initial: 'Y', color: '#FF6600', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Prolora prepares copy for manual submission.', deepLink: 'https://news.ycombinator.com/submit' },
  { id: 'medium', label: 'Medium', initial: 'M', color: '#111111', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'No supported posting API; use prepared copy.', deepLink: 'https://medium.com/new-story' },
  { id: 'substack', label: 'Substack', initial: 'S', color: '#FF6719', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'No supported posting API; use prepared copy.', deepLink: 'https://substack.com/home' },
  { id: 'betalist', label: 'BetaList', initial: 'β', color: '#1F2937', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Prolora prepares your launch copy.', deepLink: 'https://betalist.com/submit' },
  { id: 'indiehackers', label: 'Indie Hackers', initial: 'IH', color: '#0F766E', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Prolora prepares community-native copy.', deepLink: 'https://www.indiehackers.com/post' },
  { id: 'appsumo', label: 'AppSumo', initial: 'A', color: '#16A34A', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Manual launch-assist channel.', deepLink: 'https://appsumo.com/' },
  { id: 'alternativeto', label: 'AlternativeTo', initial: 'A', color: '#2563EB', availability: 'manual_assist', integrationKind: 'manual_assist', authKind: 'none', connectFlow: 'info', description: 'Manual listing-assist channel.', deepLink: 'https://alternativeto.net/' },
];

export function getConnectorDescriptor(id: string): PlatformConnectorDescriptor | undefined {
  return CONNECTION_REGISTRY.find((connector) => connector.id === id);
}

/**
 * What GET/PUT/DELETE /api/v1/connections/oauth-app/{platform} return. Lives in
 * this dependency-free module so Client Components can type the response
 * without pulling the server-only credential store into the browser bundle.
 */
export interface OAuthAppStatusDto {
  platform: 'linkedin' | 'x';
  label: string;
  /** The callback the user has to register in their own app. */
  redirect_uri: string;
  connected: boolean;
  source: 'workspace' | 'environment' | null;
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

/** Picker order: what works now first, what needs a decision last. */
export const CONNECTOR_CATEGORY_ORDER: readonly ConnectorAvailability[] = [
  'available',
  'oauth_byo',
  'manual_assist',
  'coming_soon',
] as const;

export function groupConnectorsByAvailability(): Array<{
  availability: ConnectorAvailability;
  connectors: PlatformConnectorDescriptor[];
}> {
  return CONNECTOR_CATEGORY_ORDER.map((availability) => ({
    availability,
    connectors: CONNECTION_REGISTRY.filter((connector) => connector.availability === availability),
  })).filter((group) => group.connectors.length > 0);
}
