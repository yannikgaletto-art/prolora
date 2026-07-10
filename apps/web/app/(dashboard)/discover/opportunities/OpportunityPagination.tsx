'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pagination } from '@/app/components/Pagination';

export interface OpportunityPaginationProps {
  page: number;
  perPage: number;
  total: number;
}

// Client island wrapper: Pagination itself is 'use client' but page state is
// URL-driven here so the Server Component page re-fetches on page change.
export function OpportunityPagination({ page, perPage, total }: OpportunityPaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handlePageChange(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return <Pagination page={page} perPage={perPage} total={total} onPageChange={handlePageChange} />;
}
