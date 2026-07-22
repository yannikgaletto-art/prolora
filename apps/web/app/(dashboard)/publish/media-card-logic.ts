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

// Providers report no real progress, so the bar is honest-asymptotic: it
// approaches 90% on the expected-duration curve and only the actual
// 'succeeded' poll completes it. Never 100% while still polling.
const EXPECTED_MS: Record<ComposerMediaKind, number> = {
  image: 45_000,
  video: 300_000,
};

export function generationProgress(
  status: GenerationStatus,
  elapsedMs: number,
  kind: ComposerMediaKind
): number {
  if (!shouldPollGeneration(status)) return 100;
  // 'running' means the worker picked the job up — visibly ahead of 'pending'.
  const floor = status === 'running' ? 15 : 3;
  const fraction = 1 - Math.exp(-Math.max(0, elapsedMs) / EXPECTED_MS[kind]);
  return Math.min(90, Math.round(floor + fraction * (90 - floor)));
}

// A healthy worker picks jobs up within seconds; a minute of 'pending' means
// the background runtime is down (the exact bug this guards: dead Inngest).
export const GENERATION_STALL_PENDING_MS = 60_000;

export function isGenerationStalled(status: GenerationStatus, elapsedMs: number): boolean {
  return status === 'pending' && elapsedMs >= GENERATION_STALL_PENDING_MS;
}
