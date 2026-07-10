import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { PATHNAME_HEADER } from '@/lib/http-headers';
import { AppShell } from '@/app/components/AppShell';

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

  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  // The onboarding wizard runs bare: its nav targets are still locked behind
  // the very step the user is completing.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';
  if (pathname === '/onboarding') {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <AppShell workspaceName={workspace.name} userEmail={user.email ?? ''}>
      {children}
    </AppShell>
  );
}
