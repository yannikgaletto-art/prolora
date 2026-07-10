'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination } from '@/app/components/Pagination';

export interface BoardPaginationProps {
  page: number;
  perPage: number;
  total: number;
}

// Thin client island around the shared Pagination component: it only owns
// navigation (push new ?page=), the actual data stays server-fetched.
export function BoardPagination({ page, perPage, total }: BoardPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handlePageChange(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    router.push(`?${params.toString()}`);
  }

  return <Pagination page={page} perPage={perPage} total={total} onPageChange={handlePageChange} />;
}
