import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { PATHNAME_HEADER } from '@/lib/http-headers';
import { AppShell } from '@/app/components/AppShell';
import { loadGuideState } from '@/lib/guide/load';
import { resolveGuide } from '@/lib/guide/steps';
import { getLocale } from '@/lib/i18n/server';
import { getGuideCopy } from '@/lib/i18n/guide';

// Server Component (F0-4, Pfad A): reads its data through the service layer,
// never through fetch() against our own API routes.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates this. Repeated here because a layout must never
  // render authenticated chrome on an unauthenticated request.
  if (!user) redirect('/login');

  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  // The onboarding wizard runs bare: its nav targets are still locked behind
  // the very step the user is completing.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';
  if (pathname === '/onboarding') {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  // Der geführte Faden. `loadGuideState` fängt seine Fehler selbst ab; der
  // try/catch hier ist der letzte Schutz, damit ein Problem im Faden nie das
  // ganze Dashboard verhindert — dann rendert die Shell eben ohne Leiste.
  let guide = null;
  try {
    const [state, locale] = await Promise.all([loadGuideState(workspace.id), getLocale()]);
    guide = { guide: resolveGuide(state), copy: getGuideCopy(locale) };
  } catch (error) {
    console.error('[dashboard] guide bar unavailable:', error);
  }

  return (
    <AppShell workspaceName={workspace.name} userEmail={user.email ?? ''} guide={guide}>
      {children}
    </AppShell>
  );
}
