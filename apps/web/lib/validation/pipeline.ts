import type { MediaItem, ValidationResult } from '@prolora/shared';
import type { ConnectionRow } from '@/lib/db';
import { createAdapter } from '@/lib/adapters';
import type { MediaAttachment } from '@/lib/adapters/types';
import { getPlatformRules, formatFromMime } from './platform-rules';

const MAX_SCHEDULE_DAYS = 60;

export interface PlatformValidationInput {
  connection: ConnectionRow;
  content: string;
  media: MediaItem[];
}

// Runs BEFORE the post is queued. errors -> 400, warnings -> 200 + warnings[].
// Check order per FABLE-02 Abschnitt 6.
export function validateForPlatform(input: PlatformValidationInput): ValidationResult {
  const { connection, content, media } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const rules = getPlatformRules(connection.platform);

  // 1. Connection active?
  if (connection.status !== 'active') {
    errors.push(
      `Connection ${connection.account_name} (${connection.platform}) is ${connection.status} — reconnect required`
    );
    return { valid: false, errors, warnings };
  }

  // 2. Content length — adapter handles platform specifics (Bluesky counts
  //    graphemes). Mastodon: per-instance limit from connection config.
  const adapter = createAdapter(connection.platform);
  const attachments: MediaAttachment[] = media.map((m) => ({
    storageKey: m.url,
    mimeType: m.mime_type ?? guessMimeFromType(m.type),
    altText: m.alt_text,
  }));
  const contentResult = adapter.validateContent(content, attachments);

  if (connection.platform === 'mastodon') {
    const instanceLimit = readInstanceLimit(connection);
    if (content.length > instanceLimit) {
      errors.push(
        `Content exceeds this instance's ${instanceLimit} character limit (${content.length})`
      );
    } else if (content.length > instanceLimit * 0.95) {
      warnings.push('Content is close to the instance character limit');
    }
    // Media errors from the adapter still apply.
    errors.push(...contentResult.errors.filter((e) => !e.includes('character limit')));
  } else {
    errors.push(...contentResult.errors);
    warnings.push(...contentResult.warnings);
  }

  // 3.+4. Media type/format/size compatibility
  for (const item of media) {
    const mime = item.mime_type ?? guessMimeFromType(item.type);
    const format = formatFromMime(mime);

    if (item.type === 'image') {
      if (!rules.supports_images) {
        errors.push(`${connection.platform} does not support images`);
      } else if (!rules.supported_image_formats.includes(format)) {
        // Transform pipeline auto-converts PNG->JPEG where needed; other
        // formats are hard errors.
        if (format === 'png' && rules.supported_image_formats.includes('jpeg')) {
          warnings.push('PNG will be converted to JPEG for this platform');
        } else {
          errors.push(
            `${connection.platform} does not support ${format} images (allowed: ${rules.supported_image_formats.join(', ')})`
          );
        }
      }
    } else if (item.type === 'video') {
      if (!rules.supports_video) {
        errors.push(`${connection.platform} does not support video`);
      } else if (rules.supported_video_formats && !rules.supported_video_formats.includes(format)) {
        errors.push(
          `${connection.platform} does not support ${format} video (allowed: ${rules.supported_video_formats.join(', ')})`
        );
      }
    } else if (item.type === 'document' && !rules.supports_documents) {
      errors.push(`${connection.platform} does not support document attachments`);
    }
  }

  const imageCount = media.filter((m) => m.type === 'image').length;
  if (rules.max_images !== undefined && imageCount > rules.max_images) {
    errors.push(`${connection.platform} allows at most ${rules.max_images} images (${imageCount} given)`);
  }

  // 7. Rate-limit budget — warning only: the publish job waits for the
  //    reset instead of failing the post (Invariante 5).
  const rateWarning = readRateLimitWarning(connection);
  if (rateWarning) warnings.push(rateWarning);

  return { valid: errors.length === 0, errors, warnings };
}

// 8. scheduled_at: not in the past, max 60 days out.
export function validateScheduledAt(scheduledAt: string | undefined): string[] {
  if (!scheduledAt) return [];
  const errors: string[] = [];
  const ts = new Date(scheduledAt).getTime();

  if (Number.isNaN(ts)) {
    errors.push('scheduled_at is not a valid timestamp');
    return errors;
  }
  if (ts < Date.now() - 60_000) {
    errors.push('scheduled_at is in the past');
  }
  if (ts > Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
    errors.push(`scheduled_at is more than ${MAX_SCHEDULE_DAYS} days in the future`);
  }
  return errors;
}

function readInstanceLimit(connection: ConnectionRow): number {
  const limit = connection.config?.max_characters;
  return typeof limit === 'number' && limit > 0 ? limit : 500;
}

function readRateLimitWarning(connection: ConnectionRow): string | null {
  const state = connection.rate_limit_state;
  if (!state) return null;
  const remaining = typeof state.remaining === 'number' ? state.remaining : null;
  const resetAt = typeof state.reset_at === 'string' ? state.reset_at : null;
  if (remaining !== null && remaining <= 0 && resetAt && new Date(resetAt).getTime() > Date.now()) {
    return `Rate limit for ${connection.account_name} is exhausted — the post will be published after ${resetAt}`;
  }
  return null;
}

function guessMimeFromType(type: MediaItem['type']): string {
  if (type === 'video') return 'video/mp4';
  if (type === 'document') return 'application/pdf';
  return 'image/jpeg';
}
