import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { listWorkspaceMedia } from '@/lib/media/library';
import { createSignedMediaPreviews } from '@/lib/media/transform';
import { getLocale } from '@/lib/i18n/server';
import { PublishTabs } from '../PublishTabs';
import { MediaLibrary } from './MediaLibrary';

export const metadata: Metadata = { title: 'Media — Prolora' };

// Server Component (F0-4, Pfad A): reads the library through lib/ directly.
// Previews are short-lived signed URLs; the client only ever sees storage
// keys as identifiers (Invariante 6).
export default async function PublishMediaPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const media = await listWorkspaceMedia(workspace.id);
  const previews = await createSignedMediaPreviews(media.map((item) => item.storage_key));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Publish</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every upload and AI generation in this workspace — including ones never attached to a post.
        </p>
      </div>
      <PublishTabs active="media" locale={await getLocale()} />
      <MediaLibrary media={media} previews={previews} />
    </div>
  );
}
