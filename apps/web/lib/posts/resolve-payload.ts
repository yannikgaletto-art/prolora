import type { MediaItem } from '@prolora/shared';

export interface ConnectionOverride {
  content?: string;
  media?: MediaItem[];
}

export function resolveConnectionPayload(input: {
  connectionId: string;
  content: string;
  media: MediaItem[];
  connectionOverrides?: Record<string, ConnectionOverride>;
}): { content: string; media: MediaItem[] } {
  const override = input.connectionOverrides?.[input.connectionId];
  return {
    content: override?.content ?? input.content,
    media: override?.media ?? input.media,
  };
}
