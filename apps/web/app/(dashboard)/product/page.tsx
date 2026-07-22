import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getProductProfile } from '@/lib/product/profile';
import { getLocale } from '@/lib/i18n/server';
import { getProductCopy } from '@/lib/i18n/product';
import { ProductProfileForm } from './ProductProfileForm';

export const metadata: Metadata = { title: 'Product — Prolora' };

// Server Component shell (F0-4, Pfad A): profile comes from the lib/ service
// layer directly. The form island talks to /api/v1/product/* afterwards.
export default async function ProductPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [profile, locale] = await Promise.all([getProductProfile(workspace.id), getLocale()]);
  const copy = getProductCopy(locale);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{copy.profile_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{copy.profile_subtitle}</p>
      </div>
      <ProductProfileForm initialProfile={profile} locale={locale} workspaceName={workspace.name} />
    </div>
  );
}
