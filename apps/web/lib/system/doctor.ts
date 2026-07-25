// GOAL-RUN7 T1: one server-side oracle describes feature readiness. Only
// configuration names cross the API boundary; environment values never do.
import { PLAN_LIMITS, type AppLocale, type PlanType } from '@prolora/shared';
import { getServiceDb } from '@/lib/db';
import { isRedditConfigured } from '@/lib/integrations/reddit-credentials';

/**
 * Machine-readable reason a feature is not ready. The UI branches on this —
 * `hint` is prose for humans and must never be parsed. `reddit_missing` in
 * particular is what makes the Connect-Reddit flow appear inline instead of a
 * dead-end "ask your operator" message.
 */
export type FeatureBlocker =
  | 'reddit_missing'
  | 'ai_credits_exhausted'
  | 'anthropic_missing'
  | 'openai_missing'
  | 'background_jobs_missing'
  | 'oauth_app_missing';

export type FeatureState = {
  state: 'ready' | 'setup_required' | 'coming_soon';
  missing?: string[];
  hint?: string;
  blocker?: FeatureBlocker;
  /** True when the user can fix this themselves in the UI, without env access. */
  selfServiceable?: boolean;
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
  /** Hint language. Defaults to 'de' — the previous hardcoded behaviour. */
  locale?: AppLocale;
}

// Hints used to be German string literals regardless of UI language, which is
// how an English dashboard ended up showing "der Betreiber muss …". They are
// translated here, next to the conditions that select them.
const HINTS: Record<AppLocale, Record<string, string>> = {
  de: {
    anthropic: 'Der Betreiber muss den Anthropic-Zugang konfigurieren.',
    credits: 'Keine KI-Credits im {plan}-Plan mehr verfügbar.',
    openai: 'Der Betreiber muss OPENAI_API_KEY setzen und die App neu starten.',
    inngestMedia:
      'Background-Jobs laufen nicht — Generierungen würden nie fertig. In Production beide Inngest-Keys setzen, lokal den Inngest-Dev-Server starten.',
    reddit: 'Reddit ist noch nicht verbunden. Du kannst das direkt hier erledigen.',
    discoveryCredits: 'Community-Suche benötigt verfügbare KI-Credits.',
    linkedin: 'LinkedIn OAuth muss vom Betreiber konfiguriert werden.',
    x: 'X OAuth muss vom Betreiber konfiguriert werden.',
    inngest:
      'In Production müssen beide Inngest-Keys gesetzt sein; lokal den Inngest-Dev-Server starten.',
  },
  en: {
    anthropic: 'The operator needs to configure Anthropic access.',
    credits: 'No AI credits left on the {plan} plan.',
    openai: 'The operator needs to set OPENAI_API_KEY and restart the app.',
    inngestMedia:
      'Background jobs are not running — generations would never finish. Set both Inngest keys in production, or start the Inngest dev server locally.',
    reddit: 'Reddit is not connected yet. You can do that right here.',
    discoveryCredits: 'Community discovery needs available AI credits.',
    linkedin: 'LinkedIn OAuth needs to be configured by the operator.',
    x: 'X OAuth needs to be configured by the operator.',
    inngest:
      'Both Inngest keys must be set in production; start the Inngest dev server locally.',
  },
  es: {
    anthropic: 'El operador debe configurar el acceso a Anthropic.',
    credits: 'No quedan créditos de IA en el plan {plan}.',
    openai: 'El operador debe definir OPENAI_API_KEY y reiniciar la app.',
    inngestMedia:
      'Los trabajos en segundo plano no se ejecutan — las generaciones nunca terminarían. Define ambas claves de Inngest en producción o inicia el servidor de desarrollo de Inngest en local.',
    reddit: 'Reddit aún no está conectado. Puedes hacerlo aquí mismo.',
    discoveryCredits: 'El descubrimiento de comunidades necesita créditos de IA disponibles.',
    linkedin: 'El operador debe configurar OAuth de LinkedIn.',
    x: 'El operador debe configurar OAuth de X.',
    inngest:
      'En producción deben estar definidas ambas claves de Inngest; en local inicia el servidor de desarrollo de Inngest.',
  },
};

function feature(
  missing: string[],
  hint: string,
  extra?: { blocker?: FeatureBlocker; selfServiceable?: boolean }
): FeatureState {
  return missing.length === 0
    ? { state: 'ready' }
    : { state: 'setup_required', missing, hint, ...extra };
}

export function buildSystemStatus(input: DoctorInput): SystemStatus {
  const t = HINTS[input.locale ?? 'de'];
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
        creditsAvailable ? t.anthropic : t.credits.replace('{plan}', input.plan),
        { blocker: creditsAvailable ? 'anthropic_missing' : 'ai_credits_exhausted' }
      ),
      media_generation: feature(
        mediaMissing,
        !input.configured.openai ? t.openai : t.inngestMedia,
        { blocker: !input.configured.openai ? 'openai_missing' : 'background_jobs_missing' }
      ),
      discovery: feature(
        [...redditMissing, ...aiMissing],
        redditMissing.length > 0 ? t.reddit : t.discoveryCredits,
        redditMissing.length > 0
          ? { blocker: 'reddit_missing', selfServiceable: true }
          : { blocker: 'ai_credits_exhausted' }
      ),
      listen_reddit: feature(redditMissing, t.reddit, {
        blocker: 'reddit_missing',
        selfServiceable: true,
      }),
      listen_widget: { state: 'ready' },
      connect_linkedin: feature(
        input.configured.linkedin ? [] : ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
        t.linkedin,
        { blocker: 'oauth_app_missing' }
      ),
      connect_x: feature(input.configured.x ? [] : ['X_CLIENT_ID', 'X_CLIENT_SECRET'], t.x, {
        blocker: 'oauth_app_missing',
      }),
      background_jobs: feature(inngestMissing, t.inngest, {
        blocker: 'background_jobs_missing',
      }),
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

export async function getSystemStatus(
  workspaceId: string,
  locale: AppLocale = 'de'
): Promise<SystemStatus> {
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

  // Reddit readiness is workspace-scoped since migration 014: a workspace with
  // its own connected app is ready even when the process env has no keys.
  const [inngest, reddit] = await Promise.all([
    getBackgroundJobReadiness(),
    isRedditConfigured(workspaceId),
  ]);

  return buildSystemStatus({
    plan: workspace.plan,
    creditsUsed,
    locale,
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      reddit,
      linkedin: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
      x: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
      inngest: inngest.ready,
    },
    inngestMissing: inngest.missing,
  });
}
