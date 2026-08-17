import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getLocale } from '@/lib/i18n/server';
import { PublishTabs } from '../PublishTabs';
import { WriterView } from './WriterView';
import { getWriterCopy } from './writer-copy';
import { loadWriterUiData } from './writer-service';
import {
  DEFAULT_WRITER_POLICY,
  EMPTY_WRITER_DNA,
  type WriterUiData,
} from './writer-model';

export const metadata: Metadata = { title: 'Writer — Prolora' };

export default async function WriterPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const locale = await getLocale();
  const copy = getWriterCopy(locale);
  let data: WriterUiData;
  try {
    data = await loadWriterUiData(workspace.id, workspace.name);
  } catch (error) {
    console.error('[publish/writer] safe UI load failed:', error);
    data = {
      availability: 'unavailable',
      workspaceName: workspace.name,
      policy: DEFAULT_WRITER_POLICY,
      stats: {
        awaitingApproval: 0,
        preparing: 0,
        goldenSamples: 0,
        exceptions: 0,
      },
      dna: EMPTY_WRITER_DNA,
      pendingReview: null,
      history: [],
    };
  }

  return (
    <div className="space-y-6">
      <PublishTabs active="writer" locale={locale} />
      <WriterView copy={copy} initialData={data} locale={locale} />
    </div>
  );
}
