import { PLAN_LIMITS, type AppLocale, type PlanType } from '@prolora/shared';
import { Card } from '@/app/components/Card';
import { Badge } from '@/app/components/Badge';
import { getMonthlyPostCount, getWorkspacePlan } from '@/lib/settings/usage';
import { getSystemStatus } from '@/lib/system/doctor';
import { getRun7Dict } from '@/lib/i18n/run7';

const numberFormatter = new Intl.NumberFormat('en-US');

const PLAN_LABELS: Record<PlanType, string> = {
  starter: 'Starter',
  pro: 'Pro',
  agency: 'Agency',
};

function formatLimit(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : 'Unlimited';
}

// Read-only Server Component (spec: F6 explicitly calls this out as such).
// No Upgrade button: there is no billing integration this pass, and a button
// that goes nowhere would read as dishonest — the plan and its limits are
// shown plainly instead.
export async function PlanSection({ workspaceId, locale }: { workspaceId: string; locale: AppLocale }) {
  const [plan, postCount, systemStatus] = await Promise.all([
    getWorkspacePlan(workspaceId),
    getMonthlyPostCount(workspaceId),
    getSystemStatus(workspaceId),
  ]);
  const limits = PLAN_LIMITS[plan];
  const maxPosts = limits.max_posts_per_month;
  const isUnlimited = !Number.isFinite(maxPosts);
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((postCount / maxPosts) * 100));
  const creditLimit = systemStatus.plan.ai_credits_limit;
  const creditUsed = systemStatus.plan.ai_credits_used;
  const creditPct = creditLimit > 0 && Number.isFinite(creditLimit)
    ? Math.min(100, Math.round((creditUsed / creditLimit) * 100))
    : 0;
  const dict = getRun7Dict(locale).plan;

  return (
    <div className="space-y-4">
      <Card title={dict.currentPlan} actions={<Badge tone="teal">{PLAN_LABELS[plan]}</Badge>}>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-500">{dict.postsThisMonth}</span>
          <span className="font-medium text-gray-900">
            {numberFormatter.format(postCount)} / {formatLimit(maxPosts)}
          </span>
        </div>
        {!isUnlimited && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-primary-600'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </Card>

      <Card title={dict.aiCredits}>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-500">{dict.usedThisMonth}</span>
          <span className="font-medium text-gray-900">
            {numberFormatter.format(creditUsed)} / {formatLimit(creditLimit)}
          </span>
        </div>
        {Number.isFinite(creditLimit) && creditLimit > 0 && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${creditPct >= 100 ? 'bg-red-500' : 'bg-primary-600'}`}
              style={{ width: `${creditPct}%` }}
            />
          </div>
        )}
        {creditLimit === 0 && (
          <p className="mt-2 text-xs text-amber-700">{dict.starterNoCredits}</p>
        )}
      </Card>

      <Card title="Plan limits">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Connections</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">
              {formatLimit(limits.max_connections)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Posts / month</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{formatLimit(maxPosts)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Feedback sources</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">
              {formatLimit(limits.max_feedback_sources)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Feedback items / month</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">
              {formatLimit(limits.max_feedback_items_per_month)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">AI credits</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">
              {formatLimit(limits.ai_credits)}
            </dd>
          </div>
        </dl>
        <p className="mt-5 text-sm text-gray-500">
          To change your plan, contact us — self-serve upgrades aren&apos;t available yet.
        </p>
      </Card>
    </div>
  );
}
