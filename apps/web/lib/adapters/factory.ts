import type { PlatformType } from '@prolora/shared';
import type { PlatformAdapter } from './types';
import { LinkedInAdapter } from './linkedin-adapter';
import { XAdapter } from './x-adapter';
import { BlueskyAdapter } from './bluesky-adapter';
import { MastodonAdapter } from './mastodon-adapter';
import { TelegramAdapter } from './telegram-adapter';

const adapters: Record<PlatformType, () => PlatformAdapter> = {
  linkedin: () => new LinkedInAdapter(),
  x: () => new XAdapter(),
  bluesky: () => new BlueskyAdapter(),
  mastodon: () => new MastodonAdapter(),
  telegram: () => new TelegramAdapter(),
};

export function createAdapter(platform: PlatformType): PlatformAdapter {
  const factory = adapters[platform];
  if (!factory) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return factory();
}
