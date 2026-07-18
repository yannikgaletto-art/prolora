// GOAL-RUN8 T2.2: one canonical content hash prevents edited posts from
// being calibrated against a prediction for a different draft revision.
import { createHash } from 'crypto';

export function hashScoredContent(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
