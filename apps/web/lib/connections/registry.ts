// GOAL-RUN7 T6: one metadata source drives the picker. A channel is only
// "available" when a real connect + publish path exists in this codebase.
export type ConnectorAvailability = 'available' | 'setup_required' | 'coming_soon' | 'manual_assist';
export type IntegrationKind = 'api' | 'manual_assist';
export type ConnectorFlow = 'oauth' | 'mastodon' | 'bluesky' | 'telegram' | 'credential' | 'info';

export interface CredentialFormDescriptor {
  description: string;
  secretLabel: string;
  fields?: Array<{ key: string; label: string; placeholder?: string }>;
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
  description: string;
  deepLink?: string;
}

export const CONNECTION_REGISTRY: PlatformConnectorDescriptor[] = [
  { id: 'linkedin', label: 'LinkedIn', initial: 'in', color: '#0A66C2', availability: 'setup_required', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'oauth', description: 'Operator OAuth setup required.' },
  { id: 'x', label: 'X', initial: 'X', color: '#000000', availability: 'setup_required', integrationKind: 'api', authKind: 'oauth2', connectFlow: 'oauth', description: 'Operator OAuth setup required.' },
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
