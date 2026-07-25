// GOAL-RUN7 T1: one server-side oracle describes feature readiness. Only
// configuration names cross the API boundary; environment values never do.
import { PLAN_LIMITS, type AppLocale, type PlanType } from '@prolora/shared';
import { getServiceDb } from '@/lib/db';
import { isRedditConfigured } from '@/lib/integrations/reddit-credentials';
import { isOAuthAppConfigured } from '@/lib/auth/byo-oauth';

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
      'Background-Jobs laufen nicht — Generierungen würden nie fertig. Dieser Deploy sieht den unten genannten Wert nicht: in Vercel für genau diese Umgebung (Production bzw. Preview) setzen und danach neu deployen — bestehende Deploys übernehmen geänderte Variablen nicht.',
    inngestMediaDev:
      'Background-Jobs laufen nicht — Generierungen würden nie fertig. Lokal den Inngest-Dev-Server starten (npm run dev:jobs) oder beide Inngest-Keys in .env.local setzen.',
    reddit: 'Reddit ist noch nicht verbunden. Du kannst das direkt hier erledigen.',
    discoveryCredits: 'Community-Suche benötigt verfügbare KI-Credits.',
    linkedin:
      'Noch keine LinkedIn-App hinterlegt. Unter Verbindungen deine eigene LinkedIn-App eintragen — dauert etwa zwei Minuten.',
    x: 'Noch keine X-App hinterlegt. Unter Verbindungen deine eigene X-App eintragen — dauert etwa zwei Minuten.',
    inngest:
      'Dieser Deploy sieht den unten genannten Wert nicht: in Vercel für genau diese Umgebung (Production bzw. Preview) setzen und danach neu deployen — bestehende Deploys übernehmen geänderte Variablen nicht.',
    inngestDev:
      'Lokal den Inngest-Dev-Server starten (npm run dev:jobs) oder beide Inngest-Keys in .env.local setzen.',
  },
  en: {
    anthropic: 'The operator needs to configure Anthropic access.',
    credits: 'No AI credits left on the {plan} plan.',
    openai: 'The operator needs to set OPENAI_API_KEY and restart the app.',
    inngestMedia:
      'Background jobs are not running — generations would never finish. This deployment cannot see the value named below: set it in Vercel for this exact environment (Production or Preview), then redeploy — existing deployments do not pick up changed variables.',
    inngestMediaDev:
      'Background jobs are not running — generations would never finish. Start the Inngest dev server locally (npm run dev:jobs) or set both Inngest keys in .env.local.',
    reddit: 'Reddit is not connected yet. You can do that right here.',
    discoveryCredits: 'Community discovery needs available AI credits.',
    linkedin:
      'No LinkedIn app connected yet. Add your own LinkedIn app under Connections — about two minutes.',
    x: 'No X app connected yet. Add your own X app under Connections — about two minutes.',
    inngest:
      'This deployment cannot see the value named below: set it in Vercel for this exact environment (Production or Preview), then redeploy — existing deployments do not pick up changed variables.',
    inngestDev:
      'Start the Inngest dev server locally (npm run dev:jobs) or set both Inngest keys in .env.local.',
  },
  es: {
    anthropic: 'El operador debe configurar el acceso a Anthropic.',
    credits: 'No quedan créditos de IA en el plan {plan}.',
    openai: 'El operador debe definir OPENAI_API_KEY y reiniciar la app.',
    inngestMedia:
      'Los trabajos en segundo plano no se ejecutan — las generaciones nunca terminarían. Este despliegue no ve el valor indicado abajo: defínelo en Vercel para este entorno exacto (Production o Preview) y vuelve a desplegar — los despliegues existentes no recogen variables modificadas.',
    inngestMediaDev:
      'Los trabajos en segundo plano no se ejecutan — las generaciones nunca terminarían. Inicia el servidor de desarrollo de Inngest en local (npm run dev:jobs) o define ambas claves de Inngest en .env.local.',
    reddit: 'Reddit aún no está conectado. Puedes hacerlo aquí mismo.',
    discoveryCredits: 'El descubrimiento de comunidades necesita créditos de IA disponibles.',
    linkedin:
      'Todavía no hay ninguna app de LinkedIn. Añade tu propia app de LinkedIn en Conexiones — unos dos minutos.',
    x: 'Todavía no hay ninguna app de X. Añade tu propia app de X en Conexiones — unos dos minutos.',
    inngest:
      'Este despliegue no ve el valor indicado abajo: defínelo en Vercel para este entorno exacto (Production o Preview) y vuelve a desplegar — los despliegues existentes no recogen variables modificadas.',
    inngestDev:
      'Inicia el servidor de desarrollo de Inngest en local (npm run dev:jobs) o define ambas claves de Inngest en .env.local.',
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
  // Marker, not env var names: since migration 014 the user enters their own
  // Reddit app in the UI, so pointing at a file they cannot reach would be the
  // very dead end this work removed. The UI hides markers for self-serviceable
  // blockers.
  const redditMissing = input.configured.reddit ? [] : ['REDDIT_APP'];
  const inngestMissing = input.configured.inngest
    ? []
    : (input.inngestMissing ?? ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']);
  // Der Hinweis muss zur Umgebung passen. „In Production Keys setzen, lokal den
  // Dev-Server starten" zwang den Leser, selbst zu erraten, welcher Halbsatz
  // für ihn gilt — und wer die Keys längst gesetzt hatte, las den falschen.
  const inngestIsDevServer = inngestMissing.includes('INNGEST_DEV_SERVER');
  const inngestHint = inngestIsDevServer ? t.inngestDev : t.inngest;
  const inngestMediaHint = inngestIsDevServer ? t.inngestMediaDev : t.inngestMedia;
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
        !input.configured.openai ? t.openai : inngestMediaHint,
        { blocker: !input.configured.openai ? 'openai_missing' : 'background_jobs_missing' }
      ),
      // Discovery stopped depending on Reddit with the provider registry:
      // Mastodon and Hacker News are public APIs that need no credential at all,
      // so a workspace can find communities from its first second. Reddit and
      // Bluesky are additional providers whose absence is per-provider
      // information on the Discover page — reporting the whole feature as
      // "setup required" was the false dead end this work set out to remove.
      // AI credits remain a real blocker: the relevance rating is an LLM call.
      discovery: feature(aiMissing, !input.configured.anthropic ? t.anthropic : t.discoveryCredits, {
        blocker: !input.configured.anthropic ? 'anthropic_missing' : 'ai_credits_exhausted',
      }),
      // Reddit *listening* is a different matter — it genuinely reads Reddit and
      // nothing else, so no credential means no feature. Self-serviceable since
      // migration 014, hence a marker instead of env var names.
      listen_reddit: feature(redditMissing, t.reddit, {
        blocker: 'reddit_missing',
        selfServiceable: true,
      }),
      listen_widget: { state: 'ready' },
      // Self-serviceable since BYO-OAuth: the missing piece is the *user's* own
      // developer app, entered in the UI. Naming env vars here would point at a
      // file they cannot reach for a problem they can already solve — so the
      // marker (not an env name) is what travels, and the UI hides it.
      connect_linkedin: feature(input.configured.linkedin ? [] : ['LINKEDIN_APP'], t.linkedin, {
        blocker: 'oauth_app_missing',
        selfServiceable: true,
      }),
      connect_x: feature(input.configured.x ? [] : ['X_APP'], t.x, {
        blocker: 'oauth_app_missing',
        selfServiceable: true,
      }),
      background_jobs: feature(inngestMissing, inngestHint, {
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
  const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);
  const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY);

  // Nur den TATSÄCHLICH fehlenden Schlüssel melden. Vorher nannte die Meldung
  // immer beide — wer einen von beiden gesetzt hatte, suchte den Fehler beim
  // falschen Wert und hielt eine korrekte Konfiguration für kaputt.
  const missingKeys = [
    ...(hasEventKey ? [] : ['INNGEST_EVENT_KEY']),
    ...(hasSigningKey ? [] : ['INNGEST_SIGNING_KEY']),
  ];

  if (process.env.NODE_ENV !== 'development') {
    return { ready: missingKeys.length === 0, missing: missingKeys };
  }

  // Lokal gegen Inngest Cloud zu arbeiten ist legitim: liegen beide Schlüssel
  // vor, ist der Hintergrund-Worker erreichbar und der Dev-Server irrelevant.
  // Vorher hat dieser Zweig die Schlüssel nie angesehen und dadurch eine
  // funktionierende Einrichtung als kaputt gemeldet.
  if (missingKeys.length === 0) return { ready: true, missing: [] };

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

  // Reddit readiness is workspace-scoped since migration 014, LinkedIn/X since
  // BYO-OAuth: a workspace with its own connected app is ready even when the
  // process env has no keys (and the env still works as the fallback).
  const [inngest, reddit, linkedin, x] = await Promise.all([
    getBackgroundJobReadiness(),
    isRedditConfigured(workspaceId),
    isOAuthAppConfigured(workspaceId, 'linkedin'),
    isOAuthAppConfigured(workspaceId, 'x'),
  ]);

  return buildSystemStatus({
    plan: workspace.plan,
    creditsUsed,
    locale,
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      reddit,
      linkedin,
      x,
      inngest: inngest.ready,
    },
    inngestMissing: inngest.missing,
  });
}
