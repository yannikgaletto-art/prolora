import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getConnections } from '@/lib/connections/list-connections';
import { Button } from '@/app/components/Button';
import { Input } from '@/app/components/Input';
import { Card } from '@/app/components/Card';
import { continueFromNaming, finishOnboarding, skipOnboarding } from './actions';
import { ProgressBar } from './ProgressBar';
import { ConnectStep } from './ConnectStep';
import { FeedbackQuickAdd } from './FeedbackQuickAdd';

export const metadata: Metadata = { title: 'Set up your workspace — Prolora' };

type SearchParams = Record<string, string | string[] | undefined>;

function readStep(params: SearchParams): 1 | 2 | 3 {
  const raw = Array.isArray(params.step) ? params.step[0] : params.step;
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  return 1;
}

// F7: the 3-step onboarding wizard (Oracle 4). Steps are server-driven via a
// `?step=` search param rather than client-side wizard state — every step
// already only needs data this Server Component can fetch itself (workspace
// name, connections), and the Server Actions already redirect on submit
// (the F0 step-1 pattern), so a `step` query param is the smallest change
// that keeps the whole flow correct without introducing a client-only
// wizard shell that would just re-fetch the same data a second time.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const step = readStep(params);

  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const connections = step === 2 ? await getConnections(workspace.id) : [];

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-primary-600" />
        <span className="text-lg font-semibold tracking-tight text-gray-900">Prolora</span>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <ProgressBar step={step} />

        {step === 1 && (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Name your workspace</h1>
            <p className="mt-1 text-sm text-gray-500">
              We named it after your email. Change it to whatever your team calls it.
            </p>

            <form action={continueFromNaming} className="mt-6 space-y-4">
              <Input
                label="Workspace name"
                name="name"
                defaultValue={workspace.name}
                maxLength={100}
                required
              />
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Connect your first account</h1>
            <p className="mt-1 text-sm text-gray-500">
              Prolora publishes and listens through the accounts you connect here.
            </p>

            <div className="mt-6">
              <ConnectStep connections={connections} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Take your first step</h1>
            <p className="mt-1 text-sm text-gray-500">
              Publish something, or bring in a piece of feedback to analyze.
            </p>

            <div className="mt-6 space-y-4">
              <Card title="Publish your first post" description="Write once, send it to your connected accounts.">
                <form action={finishOnboarding}>
                  <input type="hidden" name="destination" value="publish" />
                  <Button type="submit" className="w-full">
                    Go to Publish
                  </Button>
                </form>
              </Card>

              <Card
                title="Add your first feedback source"
                description="Paste in a piece of feedback to see Prolora analyze it. Automatic source integrations live on the Listen page."
              >
                <FeedbackQuickAdd />
                <p className="mt-3 text-xs text-gray-500">
                  Prefer to explore first?{' '}
                  <Link href="/listen" className="font-medium text-primary-700 hover:text-primary-800">
                    Go to Listen
                  </Link>
                </p>
              </Card>
            </div>
          </>
        )}

        <form action={skipOnboarding} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          >
            Skip for now
          </button>
        </form>
      </div>
    </div>
  );
}
