'use client';

import { type FormEvent, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/app/components/Input';
import { Select } from '@/app/components/Select';
import { Button } from '@/app/components/Button';

const SENTIMENT_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'mixed', label: 'Mixed' },
];

const CATEGORY_OPTIONS = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'praise', label: 'Praise' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// Client island: owns no server data, only rewrites the URL's search params.
// The Server Component page re-renders with the new params and re-queries
// through lib/feedback/list-feedback.ts.
export function FeedbackFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

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
          label="Search"
          placeholder="Search feedback content…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[220px] flex-1"
        />

        <Input
          label="Platform"
          placeholder="e.g. app_store"
          defaultValue={searchParams.get('platform') ?? ''}
          onBlur={(event) => apply({ platform: event.target.value.trim() || null })}
          className="w-40"
        />

        <Select
          label="Sentiment"
          placeholder="All"
          options={SENTIMENT_OPTIONS}
          value={searchParams.get('sentiment') ?? ''}
          onChange={(event) => apply({ sentiment: event.target.value || null })}
          className="w-40"
        />

        <Select
          label="Category"
          placeholder="All"
          options={CATEGORY_OPTIONS}
          value={searchParams.get('category') ?? ''}
          onChange={(event) => apply({ category: event.target.value || null })}
          className="w-44"
        />

        <Select
          label="Urgency"
          placeholder="All"
          options={URGENCY_OPTIONS}
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
          Hide duplicates
        </label>

        <div className="flex items-end gap-2 pb-0.5">
          <Button type="submit" variant="secondary" size="sm">
            Apply search
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
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
