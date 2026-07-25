import { Badge } from '@/app/components/Badge';
import { Card } from '@/app/components/Card';
import { getSystemStatus, type FeatureState } from '@/lib/system/doctor';
import { getRedditIntegrationStatus } from '@/lib/integrations/reddit-credentials';
import type { AppLocale } from '@prolora/shared';
import { getRun7Dict } from '@/lib/i18n/run7';
import { RedditIntegrationCard } from './RedditIntegrationCard';

const STATE_TONES: Record<FeatureState['state'], 'green' | 'amber' | 'gray'> = {
  ready: 'green',
  setup_required: 'amber',
  coming_soon: 'gray',
};

export async function SystemStatusSection({ workspaceId, locale }: { workspaceId: string; locale: AppLocale }) {
  const [status, reddit] = await Promise.all([
    getSystemStatus(workspaceId, locale),
    getRedditIntegrationStatus(workspaceId),
  ]);
  const dict = getRun7Dict(locale).system;
  const featureLabels: Record<keyof typeof status.features, string> = {
    ai_drafts: dict.aiDrafts, media_generation: dict.mediaGeneration, discovery: dict.discovery,
    listen_reddit: dict.listenReddit, listen_widget: dict.listenWidget,
    connect_linkedin: dict.connectLinkedin, connect_x: dict.connectX, background_jobs: dict.backgroundJobs,
  };
  const stateLabels: Record<FeatureState['state'], string> = { ready: dict.ready, setup_required: dict.setupRequired, coming_soon: dict.comingSoon };

  return (
    <div className="space-y-4">
      <RedditIntegrationCard initialStatus={reddit} />

      <Card title={dict.title} description={dict.description}>
        <ul className="divide-y divide-gray-100">
        {Object.entries(status.features).map(([key, feature]) => (
          <li key={key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {featureLabels[key as keyof typeof featureLabels]}
              </p>
              {feature.hint && feature.state !== 'ready' && (
                <p className="mt-1 text-xs text-gray-600">{feature.hint}</p>
              )}
              {/* Env-var names are only useful to whoever can edit the env.
                  For self-serviceable blockers (Reddit) they are noise — the
                  user fixes those in the UI, not in a file. */}
              {!feature.selfServiceable && feature.missing && feature.missing.length > 0 && (
                <p className="mt-1 font-mono text-xs text-gray-500">{feature.missing.join(' · ')}</p>
              )}
            </div>
            <Badge tone={STATE_TONES[feature.state]}>{stateLabels[feature.state]}</Badge>
          </li>
        ))}
        </ul>
      </Card>
    </div>
  );
}
