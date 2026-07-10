'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pagination } from '@/app/components/Pagination';

export interface FeedbackPaginationProps {
  page: number;
  perPage: number;
  total: number;
}

// Thin client island wrapping the shared Pagination component (itself
// 'use client') so the Server Component page can stay a Server Component.
export function FeedbackPagination({ page, perPage, total }: FeedbackPaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onPageChange(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return <Pagination page={page} perPage={perPage} total={total} onPageChange={onPageChange} />;
}
