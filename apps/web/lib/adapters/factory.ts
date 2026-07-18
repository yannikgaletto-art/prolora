import type { PlatformType } from '@prolora/shared';
import type { PlatformAdapter } from './types';
import { LinkedInAdapter } from './linkedin-adapter';
import { XAdapter } from './x-adapter';
import { BlueskyAdapter } from './bluesky-adapter';
import { MastodonAdapter } from './mastodon-adapter';
import { TelegramAdapter } from './telegram-adapter';
import { DiscordAdapter } from './discord-adapter';
import { DevtoAdapter } from './devto-adapter';
import { HashnodeAdapter } from './hashnode-adapter';

const adapters: Record<PlatformType, () => PlatformAdapter> = {
  linkedin: () => new LinkedInAdapter(),
  x: () => new XAdapter(),
  bluesky: () => new BlueskyAdapter(),
  mastodon: () => new MastodonAdapter(),
  telegram: () => new TelegramAdapter(),
  discord: () => new DiscordAdapter(),
  devto: () => new DevtoAdapter(),
  hashnode: () => new HashnodeAdapter(),
};

export function createAdapter(platform: PlatformType): PlatformAdapter {
  const factory = adapters[platform];
  if (!factory) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return factory();
}
