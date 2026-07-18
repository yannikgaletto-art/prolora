import type { CreatePostRequest } from '@prolora/shared';

export function buildConnectionOverrides(input: {
  masterContent: string;
  selectedConnectionIds: Set<string>;
  contentByConnection: Record<string, string>;
}): NonNullable<CreatePostRequest['connection_overrides']> {
  const overrides: NonNullable<CreatePostRequest['connection_overrides']> = {};

  for (const connectionId of input.selectedConnectionIds) {
    const content = input.contentByConnection[connectionId]?.trim();
    if (content && content !== input.masterContent.trim()) {
      overrides[connectionId] = { content };
    }
  }

  return overrides;
}
