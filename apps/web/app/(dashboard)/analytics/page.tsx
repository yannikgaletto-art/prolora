import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getPostAnalytics } from '@/lib/analytics/post-metrics';
import { getImpactAnalytics } from '@/lib/analytics/impact';
import { fill, getDict } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { Card, StatCard } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import { PLATFORM_META } from '../publish/platform-meta';

export const metadata: Metadata = { title: 'Analytics — Prolora' };

const numberFormatter = new Intl.NumberFormat('en-US');
const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function preview(content: string, max = 140): string {
  const trimmed = content.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// Server Component (F8 Analytics): reads through lib/analytics/post-metrics.ts
// directly, never by fetch()-ing our own /api/v1/* routes.
export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const [analytics, impact, locale] = await Promise.all([
    getPostAnalytics(workspace.id),
    getImpactAnalytics(workspace.id),
    getLocale(),
  ]);
  const dict = getDict(locale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Performance across every post published from this workspace.
        </p>
      </div>

      <Card title={dict.impact_accuracy_title} description={dict.impact_accuracy_description}>
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-900">
            {impact.evaluated < 5
              ? fill(dict.impact_accuracy_low_data, { n: impact.evaluated })
              : fill(dict.impact_accuracy_result, {
                  n: impact.evaluated,
                  percent: percentFormatter.format(impact.accuracy ?? 0),
                })}
          </p>
          {impact.evaluated > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {dict.impact_accuracy_matrix}
              </p>
              <table className="w-full min-w-[520px] text-center text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="px-2 py-2 text-left" />
                    <th className="px-2 py-2">{dict.impact_bucket_below}</th>
                    <th className="px-2 py-2">{dict.impact_bucket_inline}</th>
                    <th className="px-2 py-2">{dict.impact_bucket_above}</th>
                    <th className="px-2 py-2">{dict.impact_bucket_outlier}</th>
                  </tr>
                </thead>
                <tbody>
                  {(['green', 'yellow', 'red'] as const).map((light) => (
                    <tr key={light} className="border-t border-gray-100">
                      <th className="px-2 py-2 text-left font-semibold capitalize text-gray-700">
                        {light === 'green' ? dict.impact_green : light === 'yellow' ? dict.impact_yellow : dict.impact_red}
                      </th>
                      {(['below', 'inline', 'above', 'outlier'] as const).map((bucket) => (
                        <td key={bucket} className="px-2 py-2 font-semibold text-gray-900">
                          {impact.matrix[light][bucket]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {analytics.totalPosts === 0 ? (
        <EmptyState
          title="No data yet"
          description="Once you publish posts and their metrics come in, you'll see reach, engagement and your best-performing post here."
          action={
            <Link
              href="/publish"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              Create a post
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total Posts" value={numberFormatter.format(analytics.totalPosts)} />
            <StatCard label="Published" value={numberFormatter.format(analytics.publishedCount)} />
            <StatCard label="Failed" value={numberFormatter.format(analytics.failedCount)} />
            <StatCard label="Total Reach" value={numberFormatter.format(analytics.totalReach)} hint="Sum of impressions" />
          </div>

          <Card title="Posts per platform" description="Share of posts sent to each connected platform.">
            <div className="flex flex-col gap-4">
              {analytics.postsPerPlatform.map(({ platform, count, percentage }) => {
                const meta = PLATFORM_META[platform];
                return (
                  <div key={platform} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-900">{meta.label}</span>
                      <span className="text-gray-500">
                        {numberFormatter.format(count)} post{count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-primary-600"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Engagement rate per platform"
            description="(likes + comments) ÷ impressions for posts with recorded metrics."
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs font-medium text-gray-500">
                    <th className="px-5 py-2.5">Platform</th>
                    <th className="px-5 py-2.5">Likes</th>
                    <th className="px-5 py-2.5">Comments</th>
                    <th className="px-5 py-2.5">Impressions</th>
                    <th className="px-5 py-2.5">Engagement rate</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.engagementPerPlatform.map(({ platform, likes, comments, impressions, rate }) => (
                    <tr key={platform} className="border-b border-gray-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-gray-900">{PLATFORM_META[platform].label}</td>
                      <td className="px-5 py-3 text-gray-600">{numberFormatter.format(likes)}</td>
                      <td className="px-5 py-3 text-gray-600">{numberFormatter.format(comments)}</td>
                      <td className="px-5 py-3 text-gray-600">{numberFormatter.format(impressions)}</td>
                      <td className="px-5 py-3 text-gray-600">
                        {impressions > 0 ? percentFormatter.format(rate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {analytics.bestPost && (
            <Card
              title="Best-performing post"
              description={`Highest engagement rate — ${PLATFORM_META[analytics.bestPost.platform].label}`}
            >
              <div className="flex flex-col gap-3">
                <p className="text-sm text-gray-900">{preview(analytics.bestPost.content)}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  {analytics.bestPost.publishedAt && (
                    <span>{dateFormatter.format(new Date(analytics.bestPost.publishedAt))}</span>
                  )}
                  <span>{numberFormatter.format(analytics.bestPost.likes)} likes</span>
                  <span>{numberFormatter.format(analytics.bestPost.comments)} comments</span>
                  <span>{numberFormatter.format(analytics.bestPost.impressions)} impressions</span>
                  <span className="font-medium text-primary-700">
                    {percentFormatter.format(analytics.bestPost.engagementRate)} engagement
                  </span>
                </div>
                {analytics.bestPost.platformUrl && (
                  <a
                    href={analytics.bestPost.platformUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
                  >
                    View on {PLATFORM_META[analytics.bestPost.platform].label}
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
