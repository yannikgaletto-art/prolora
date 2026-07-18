export type ComposerMediaKind = 'image' | 'video';
export type ComposerMediaFormat = 'square' | 'portrait' | 'landscape';
export type GenerationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export function normalizeMediaFormat(
  kind: ComposerMediaKind,
  format: ComposerMediaFormat
): ComposerMediaFormat {
  return kind === 'video' && format === 'square' ? 'portrait' : format;
}

export function shouldPollGeneration(status: GenerationStatus): boolean {
  return status === 'pending' || status === 'running';
}
