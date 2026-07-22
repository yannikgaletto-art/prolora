// GOAL-RUN7 T1: one server-side oracle describes feature readiness. Only
// configuration names cross the API boundary; environment values never do.
import { PLAN_LIMITS, type PlanType } from '@prolora/shared';
import { getServiceDb } from '@/lib/db';

export type FeatureState = {
  state: 'ready' | 'setup_required' | 'coming_soon';
  missing?: string[];
  hint?: string;
};

export interface SystemStatus {
  features: {
    ai_drafts: FeatureState;
    media_generation: FeatureState;
    discovery: FeatureState;
    listen_reddit: FeatureState;
    listen_widget: FeatureState;
    connect_linkedin: FeatureState;
    connect_x: FeatureState;
    background_jobs: FeatureState;
  };
  plan: {
    name: PlanType;
    ai_credits_limit: number;
    ai_credits_used: number;
  };
}

interface DoctorInput {
  plan: PlanType;
  creditsUsed: number;
  configured: {
    anthropic: boolean;
    openai: boolean;
    reddit: boolean;
    linkedin: boolean;
    x: boolean;
    inngest: boolean;
  };
  inngestMissing?: string[];
}

function feature(missing: string[], hint: string): FeatureState {
  return missing.length === 0
    ? { state: 'ready' }
    : { state: 'setup_required', missing, hint };
}

export function buildSystemStatus(input: DoctorInput): SystemStatus {
  const limit = PLAN_LIMITS[input.plan].ai_credits;
  const creditsAvailable = !Number.isFinite(limit) || input.creditsUsed < limit;
  const aiMissing = [
    ...(!input.configured.anthropic ? ['ANTHROPIC_API_KEY'] : []),
    ...(!creditsAvailable ? ['AI_CREDITS'] : []),
  ];
  const redditMissing = input.configured.reddit
    ? []
    : ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'];
  const inngestMissing = input.configured.inngest
    ? []
    : (input.inngestMissing ?? ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']);
  // Generations run in an Inngest worker — without background jobs the row
  // stays 'pending' forever and the budget reservation is paid into the void.
  const mediaMissing = [
    ...(input.configured.openai ? [] : ['OPENAI_API_KEY']),
    ...inngestMissing,
  ];

  return {
    features: {
      ai_drafts: feature(
        aiMissing,
        creditsAvailable
          ? 'Der Betreiber muss den Anthropic-Zugang konfigurieren.'
          : `0 AI-Credits im ${input.plan}-Plan verfügbar.`
      ),
      media_generation: feature(
        mediaMissing,
        !input.configured.openai
          ? 'Der Betreiber muss OPENAI_API_KEY setzen und die App neu starten.'
          : 'Background-Jobs laufen nicht — Generierungen würden nie fertig. In Production beide Inngest-Keys setzen, lokal den Inngest-Dev-Server starten.'
      ),
      discovery: feature(
        [...aiMissing, ...redditMissing],
        redditMissing.length > 0
          ? 'Reddit-Zugang fehlt — der Betreiber muss REDDIT_CLIENT_ID und REDDIT_CLIENT_SECRET setzen.'
          : 'Community Discovery benötigt verfügbare AI-Credits.'
      ),
      listen_reddit: feature(
        redditMissing,
        'Reddit-Zugang fehlt — der Betreiber muss REDDIT_CLIENT_ID und REDDIT_CLIENT_SECRET setzen.'
      ),
      listen_widget: { state: 'ready' },
      connect_linkedin: feature(
        input.configured.linkedin ? [] : ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
        'LinkedIn OAuth muss vom Betreiber konfiguriert werden.'
      ),
      connect_x: feature(
        input.configured.x ? [] : ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
        'X OAuth muss vom Betreiber konfiguriert werden.'
      ),
      background_jobs: feature(
        inngestMissing,
        'In Production müssen beide Inngest-Keys gesetzt sein; lokal den Inngest-Dev-Server starten.'
      ),
    },
    plan: {
      name: input.plan,
      ai_credits_limit: limit,
      ai_credits_used: input.creditsUsed,
    },
  };
}

export async function getBackgroundJobReadiness(): Promise<{ ready: boolean; missing: string[] }> {
  if (process.env.NODE_ENV !== 'development') {
    const ready = Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
    return { ready, missing: ready ? [] : ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'] };
  }

  try {
    const response = await fetch(process.env.INNGEST_DEV_SERVER_URL ?? 'http://127.0.0.1:8288/', {
      signal: AbortSignal.timeout(750),
      cache: 'no-store',
    });
    return { ready: response.ok, missing: response.ok ? [] : ['INNGEST_DEV_SERVER'] };
  } catch {
    return { ready: false, missing: ['INNGEST_DEV_SERVER'] };
  }
}

export async function getSystemStatus(workspaceId: string): Promise<SystemStatus> {
  const db = getServiceDb();
  const { data: workspace, error } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .single<{ plan: PlanType }>();
  if (error || !workspace) {
    throw new Error(`[system:doctor] workspace lookup failed: ${error?.message ?? 'not found'}`);
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const pageSize = 1000;
  let creditsUsed = 0;
  for (let page = 0; page < 20; page += 1) {
    const { data: usage, error: usageError } = await db
      .from('usage_logs')
      .select('credits_used')
      .eq('workspace_id', workspaceId)
      .gte('created_at', monthStart.toISOString())
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .returns<{ credits_used: number | null }[]>();
    if (usageError) throw new Error(`[system:doctor] credit lookup failed: ${usageError.message}`);
    const rows = usage ?? [];
    creditsUsed += rows.reduce((sum, row) => sum + Number(row.credits_used ?? 0), 0);
    if (rows.length < pageSize) break;
  }

  const inngest = await getBackgroundJobReadiness();
  return buildSystemStatus({
    plan: workspace.plan,
    creditsUsed,
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      reddit: Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
      linkedin: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
      x: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
      inngest: inngest.ready,
    },
    inngestMissing: inngest.missing,
  });
}
