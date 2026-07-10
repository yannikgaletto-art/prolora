'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select, type SelectOption } from '@/app/components/Select';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'new', label: 'New' },
  { value: 'drafted', label: 'Drafted' },
  { value: 'posted', label: 'Posted' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'expired', label: 'Expired' },
];

export interface OpportunityFiltersProps {
  communityOptions: SelectOption[];
}

// Client island: filters live in the URL search params so the Server
// Component page re-fetches with the new filters on navigation.
export function OpportunityFilters({ communityOptions }: OpportunityFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Select
        label="Status"
        className="w-44"
        placeholder="All statuses"
        options={STATUS_OPTIONS}
        value={searchParams.get('status') ?? ''}
        onChange={(event) => setParam('status', event.target.value)}
      />
      <Select
        label="Community"
        className="w-56"
        placeholder="All communities"
        options={communityOptions}
        value={searchParams.get('community') ?? ''}
        onChange={(event) => setParam('community', event.target.value)}
      />
    </div>
  );
}
