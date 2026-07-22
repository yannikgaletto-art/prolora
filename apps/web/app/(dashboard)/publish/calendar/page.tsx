import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getCalendar } from '@/lib/posts/calendar';
import { PublishTabs } from '../PublishTabs';
import { CalendarView } from './CalendarView';

export const metadata: Metadata = { title: 'Calendar — Prolora' };

// Server Component (F0-4, Pfad A): the initial month is loaded through the
// lib/ service layer; month navigation happens client-side via /api/v1/calendar.
export default async function PublishCalendarPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  // Initial window: current month ± overscan, computed in UTC. The client
  // re-fetches with exact grid bounds in the viewer's zone right after mount.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 20)).toISOString();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 12)).toISOString();
  const initial = await getCalendar(workspace.id, from, to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">Schedule and manage your content.</p>
      </div>
      <PublishTabs active="calendar" />
      <CalendarView initialGroups={initial.groups} initialDrafts={initial.drafts} />
    </div>
  );
}
