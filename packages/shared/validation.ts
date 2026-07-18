import { z } from 'zod';

export const platformTypeSchema = z.enum([
  'linkedin',
  'x',
  'bluesky',
  'mastodon',
  'telegram',
  'discord',
  'devto',
  'hashnode',
]);

export const creatorStyleSchema = z.enum([
  'neutral',
  'hormozi_carousel',
  'ai_automation_screencast',
  'doku_modus',
  'welsh_short',
  'koe_pia',
  'abdaal_evidence',
]);

export const updateCreatorStyleSchema = z.object({
  creator_style: creatorStyleSchema,
});

export const createPostSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
  platforms: z.array(z.string().uuid()).min(1, 'At least one platform required'),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'document']),
    url: z.string().min(1),
    alt_text: z.string().optional(),
    mime_type: z.string().optional(),
  })).optional(),
  platform_overrides: z.record(z.string(), z.object({
    content: z.string().optional(),
    media: z.array(z.object({
      url: z.string(),
      alt_text: z.string().optional(),
    })).optional(),
  })).optional(),
  connection_overrides: z.record(z.string().uuid(), z.object({
    content: z.string().min(1).max(10000).optional(),
    media: z.array(z.object({
      type: z.enum(['image', 'video', 'document']),
      url: z.string().min(1),
      alt_text: z.string().optional(),
      mime_type: z.string().optional(),
    })).max(10).optional(),
  })).optional(),
  scheduled_at: z.string().datetime().optional(),
  scheduled_tz: z.string().min(1).max(64).optional(),
  draft: z.boolean().optional(),
  first_comment: z.string().max(2000).optional(),
  adapt_content: z.boolean().optional(),
  evergreen: z.boolean().optional(),
  workspace_id: z.string().uuid().optional(),
});

export const feedbackQuerySchema = z.object({
  workspace_id: z.string().uuid(),
  platform: z.string().optional(),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']).optional(),
  category: z.enum(['bug', 'feature_request', 'praise', 'complaint', 'question', 'other']).optional(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  search: z.string().max(200).optional(),
  is_duplicate: z.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export const webhookCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(['post.published', 'post.failed', 'feedback.received', 'feedback.alert'])).min(1),
});

export const communityDiscoverySchema = z.object({
  workspace_id: z.string().uuid(),
  product_description: z.string().min(10).max(2000),
  target_audience: z.string().min(10).max(1000),
  competitors: z.array(z.string()).optional(),
  platforms: z.array(z.enum(['reddit', 'facebook', 'discord', 'forum'])).optional(),
});

export const draftRequestSchema = z.object({
  opportunity_id: z.string().uuid(),
  voice_config: z.object({
    tone: z.enum(['casual', 'professional', 'technical', 'empathetic']).optional(),
    language: z.string().optional(),
    max_reply_length: z.number().int().min(50).max(5000).optional(),
    include_personal_experience: z.boolean().optional(),
    avoid_patterns: z.array(z.string()).optional(),
  }).optional(),
});

export const autoContextSchema = z.object({
  website_url: z.string().url(),
  workspace_id: z.string().uuid(),
});

export const boardItemCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  submitted_by_email: z.string().email().optional(),
  submitted_by_name: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
});

export const feedbackStatusSchema = z.object({
  status: z.enum(['new', 'reviewed', 'planned', 'in_progress', 'shipped']),
});

// Kein workspace_id im Body: der Workspace kommt IMMER aus der Auth-Session
// (getWorkspaceId) — ein Body-Feld würde nur Verwirrung über die Quelle stiften.
export const templatePrefillSchema = z.object({
  template_id: z.string().min(1).max(100),
});

export const templateDraftSchema = z.object({
  template_id: z.string().min(1).max(100),
  slots: z.record(z.string(), z.string().max(500)),
  target_platforms: z
    .array(z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']))
    .min(1)
    .max(5),
  mode: z.enum(['scaffold', 'ai']).default('ai'),
  workspace_id: z.string().uuid().optional(),
});

export const scorePostSchema = z.object({
  content: z.string().min(1).max(30_000),
  platform: platformTypeSchema,
  first_comment: z.string().max(2_000).optional(),
  language: z.string().length(2).optional(),
  connection_id: z.string().uuid().optional(),
});
