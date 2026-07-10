import { z } from 'zod';

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY_V2: z.string().length(64).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  OAUTH_STATE_SECRET: z.string().min(32).optional(),
}).refine(
  (data) => data.TOKEN_ENCRYPTION_KEY_V2 || data.TOKEN_ENCRYPTION_KEY,
  { message: 'Either TOKEN_ENCRYPTION_KEY_V2 or TOKEN_ENCRYPTION_KEY must be set' }
);

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let _validated: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (_validated) return _validated;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Missing or invalid environment variables:\n  ${missing}`);
  }
  _validated = parsed.data;
  return _validated;
}
