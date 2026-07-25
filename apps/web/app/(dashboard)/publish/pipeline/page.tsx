import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getLocale } from '@/lib/i18n/server';
import { loadCockpit, type CockpitData } from '@/lib/pipeline/orchestrator';
import { PublishTabs } from '../PublishTabs';
import { CockpitView } from './CockpitView';
import { getPipelineCopy } from './copy';

export const metadata: Metadata = { title: 'Content-Fabrik — Prolora' };

// Server Component (F0-4, Pfad A): liest über den lib/-Servicelayer, nicht per
// fetch() auf die eigene API. Fehlt Migration 017, liefert der Servicelayer
// leere Listen — die Seite zeigt dann den Leerzustand statt zu crashen.
export default async function PipelinePage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const locale = await getLocale();
  const copy = getPipelineCopy(locale);

  let cockpit: CockpitData;
  try {
    cockpit = await loadCockpit(workspace.id);
  } catch (error) {
    console.error('[publish/pipeline] cockpit load failed:', error);
    cockpit = {
      counts: {
        scheduledToday: 0,
        inGate: 0,
        needsProof: 0,
        blocked: 0,
        stalled: 0,
        coverageDays: null,
      },
      items: [],
      gate: {
        evaluated: 0,
        passed: 0,
        blocked: 0,
        overridden: 0,
        blockedBy: { proof_binding: 0, structure: 0, deterministic: 0, self_similarity: 0 },
        skipped: { proof_binding: 0, structure: 0, deterministic: 0, self_similarity: 0 },
      },
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{copy.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{copy.subtitle}</p>
      </div>
      <PublishTabs active="pipeline" />
      <CockpitView
        copy={copy}
        counts={cockpit.counts}
        items={cockpit.items}
        gate={cockpit.gate}
      />
    </div>
  );
}
