'use client';

import { type FormEvent, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppLocale } from '@prolora/shared';
import { Input } from '@/app/components/Input';
import { Select } from '@/app/components/Select';
import { Button } from '@/app/components/Button';
import { getRun7Dict } from '@/lib/i18n/run7';

// Client island: owns no server data, only rewrites the URL's search params.
// The Server Component page re-renders with the new params and re-queries
// through lib/feedback/list-feedback.ts.
//
// The source/platform filter deliberately does NOT live here: SourceRail owns
// it. Two controls for one concept is how the old bar ended up with a
// free-text "Platform" box whose only guidance was a made-up example value.
export function FeedbackFilterBar({ locale }: { locale: AppLocale }) {
  const dict = getRun7Dict(locale).listen;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const sentimentOptions = (['positive', 'negative', 'neutral', 'mixed'] as const).map((value) => ({
    value,
    label: dict.sentimentLabels[value],
  }));
  const categoryOptions = (
    ['bug', 'feature_request', 'praise', 'complaint', 'question', 'other'] as const
  ).map((value) => ({ value, label: dict.categoryLabels[value] }));
  const urgencyOptions = (['low', 'medium', 'high', 'critical'] as const).map((value) => ({
    value,
    label: dict.urgencyLabels[value],
  }));

  function apply(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('page'); // any filter change resets pagination
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({ search: search.trim() || null });
  }

  const hasFilters = [...searchParams.keys()].some((key) => key !== 'page');
  const hideDuplicates = searchParams.get('is_duplicate') === 'false';

  return (
    <form
      onSubmit={handleSearchSubmit}
      className="rounded-lg border border-gray-200 bg-white px-4 py-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={dict.search}
          placeholder={dict.searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[220px] flex-1"
        />

        <Select
          label={dict.sentimentFilter}
          placeholder={dict.all}
          options={sentimentOptions}
          value={searchParams.get('sentiment') ?? ''}
          onChange={(event) => apply({ sentiment: event.target.value || null })}
          className="w-40"
        />

        <Select
          label={dict.categoryFilter}
          placeholder={dict.all}
          options={categoryOptions}
          value={searchParams.get('category') ?? ''}
          onChange={(event) => apply({ category: event.target.value || null })}
          className="w-44"
        />

        <Select
          label={dict.urgencyFilter}
          placeholder={dict.all}
          options={urgencyOptions}
          value={searchParams.get('urgency') ?? ''}
          onChange={(event) => apply({ urgency: event.target.value || null })}
          className="w-36"
        />

        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={hideDuplicates}
            onChange={(event) => apply({ is_duplicate: event.target.checked ? 'false' : null })}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
          />
          {dict.hideDuplicates}
        </label>

        <div className="flex items-end gap-2 pb-0.5">
          <Button type="submit" variant="secondary" size="sm">
            {dict.applySearch}
          </Button>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                router.push(pathname);
              }}
            >
              {dict.clear}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
