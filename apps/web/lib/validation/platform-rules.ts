import type { PlatformType, PlatformRules } from '@prolora/shared';

// Ground truth for validation. Platforms change limits regularly — keep
// this file the ONLY place such numbers live (FABLE-02 Abschnitt 6).
export const PLATFORM_RULES: Record<PlatformType, PlatformRules> = {
  linkedin: {
    max_text_length: 3000,
    supports_text_only: true,
    supports_images: true,
    max_images: 9,
    supports_video: true,
    max_video_size_mb: 200,
    supports_documents: true, // PDF — company pages only
    max_document_size_mb: 100,
    supported_image_formats: ['jpeg', 'png', 'gif'],
    supported_video_formats: ['mp4'],
    min_aspect_ratio: 0.565, // ~9:16
    max_aspect_ratio: 1.91, // 1.91:1
    supports_poll: false,
    supports_first_comment: true,
    supports_link_preview: true,
    supports_thread: false,
    supports_carousel: true,
    max_carousel_items: 10,
  },
  x: {
    max_text_length: 280,
    supports_text_only: true,
    supports_images: true,
    max_images: 4,
    supports_video: true,
    max_video_size_mb: 512,
    supports_documents: false,
    supported_image_formats: ['jpeg', 'png', 'gif', 'webp'],
    supported_video_formats: ['mp4'],
    supports_poll: true,
    max_poll_options: 4,
    supports_first_comment: true,
    supports_link_preview: true,
    supports_thread: true,
    max_thread_tweets: 25,
    supports_carousel: false,
  },
  bluesky: {
    max_text_length: 300, // 300 GRAPHEMES, not characters!
    text_count_mode: 'grapheme',
    supports_text_only: true,
    supports_images: true,
    max_images: 4,
    max_image_size_mb: 1,
    supports_video: false,
    supports_documents: false,
    supported_image_formats: ['jpeg', 'png'],
    supports_poll: false,
    supports_first_comment: true, // via reply
    supports_link_preview: true, // via embed.external
    supports_thread: false,
    supports_carousel: false,
  },
  mastodon: {
    max_text_length: 500, // default — actual limit loaded per instance!
    max_text_length_dynamic: true,
    supports_text_only: true,
    supports_images: true,
    max_images: 4,
    supports_video: true,
    max_video_size_mb: 40,
    supports_documents: false,
    supported_image_formats: ['jpeg', 'png', 'gif', 'webp'],
    supported_video_formats: ['mp4', 'webm'],
    supports_poll: true,
    max_poll_options: 4,
    supports_first_comment: true,
    supports_link_preview: true, // automatic by instance
    supports_thread: false,
    supports_carousel: false,
    supports_content_warning: true,
  },
  telegram: {
    max_text_length: 4096,
    supports_text_only: true,
    supports_images: true,
    max_images: 10, // media group
    supports_video: true,
    max_video_size_mb: 2048,
    supports_documents: true,
    max_document_size_mb: 2048,
    supported_image_formats: ['jpeg', 'png', 'gif', 'webp'],
    supported_video_formats: ['mp4'],
    supports_poll: false, // bots use a different API for polls
    supports_first_comment: true,
    supports_link_preview: true, // automatic
    supports_thread: false,
    supports_carousel: false, // media groups are similar but different
  },
  discord: {
    max_text_length: 2000,
    supports_text_only: true,
    supports_images: true,
    max_images: 10,
    supports_video: false,
    supports_documents: false,
    supported_image_formats: ['jpeg', 'png', 'gif', 'webp'],
    supported_video_formats: ['mp4'],
    supports_poll: false,
    supports_first_comment: false,
    supports_link_preview: true,
    supports_thread: false,
    supports_carousel: false,
  },
  devto: {
    max_text_length: 10000,
    supports_text_only: true,
    supports_images: false,
    supports_video: false,
    supports_documents: false,
    supported_image_formats: [],
    supports_poll: false,
    supports_first_comment: false,
    supports_link_preview: true,
    supports_thread: false,
    supports_carousel: false,
  },
  hashnode: {
    max_text_length: 10000,
    supports_text_only: true,
    supports_images: false,
    supports_video: false,
    supports_documents: false,
    supported_image_formats: [],
    supports_poll: false,
    supports_first_comment: false,
    supports_link_preview: true,
    supports_thread: false,
    supports_carousel: false,
  },
};

export function getPlatformRules(platform: PlatformType): PlatformRules {
  return PLATFORM_RULES[platform];
}

// 'image/jpeg' -> 'jpeg', 'image/svg+xml' -> 'svg'
export function formatFromMime(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? '';
  const base = subtype.split('+')[0];
  return base === 'jpg' ? 'jpeg' : base;
}
