import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api/http';
import {
  BOARD_ITEM_STATUSES,
  getPublicBoardItemsFiltered,
  type BoardSort,
  type BoardItemStatus,
} from '@/lib/board/board-service';
import { Badge } from '@/app/components/Badge';
import { EmptyState } from '@/app/components/EmptyState';
import { SubmitForm } from './SubmitForm';
import { VoteButton } from './VoteButton';
import { BoardPagination } from './BoardPagination';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; sort?: string; status?: string }>;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

function isBoardStatus(value: string | undefined): value is BoardItemStatus {
  return !!value && (BOARD_ITEM_STATUSES as readonly string[]).includes(value);
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Feedback board — ${slug}` };
}

// Public, unauthenticated board (F5-2, Oracle 6). Outside the (dashboard)
// group and outside middleware's auth gate entirely — see
// middleware.ts's PUBLIC_BOARD regex.
export default async function PublicBoardPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;

  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const sort: BoardSort = query.sort === 'new' ? 'new' : 'votes';
  const status = isBoardStatus(query.status) ? query.status : undefined;

  let data;
  try {
    data = await getPublicBoardItemsFiltered(slug, { page, sort, status });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const buildHref = (overrides: { page?: number; sort?: BoardSort; status?: BoardItemStatus | 'all' }) => {
    const params = new URLSearchParams();
    const nextSort = overrides.sort ?? sort;
    const nextStatus = overrides.status ?? status ?? 'all';
    const nextPage = overrides.page ?? 1;
    if (nextSort !== 'votes') params.set('sort', nextSort);
    if (nextStatus !== 'all') params.set('status', nextStatus);
    if (nextPage !== 1) params.set('page', String(nextPage));
    const qs = params.toString();
    return qs ? `/board/${slug}?${qs}` : `/board/${slug}`;
  };

  const tabClasses = (active: boolean) =>
    `inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
      active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'
    }`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />
          <span className="text-sm font-medium text-gray-500">{data.workspaceName}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Feedback board</h1>
        <p className="mt-1 text-sm text-gray-500">
          Share an idea, upvote what matters to you, and track what&apos;s shipping.
        </p>
      </header>

      <div className="mb-6">
        <SubmitForm slug={slug} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status: 'all', page: 1 })} className={tabClasses(!status)}>
            All
          </Link>
          {BOARD_ITEM_STATUSES.map((s) => (
            <Link key={s} href={buildHref({ status: s, page: 1 })} className={tabClasses(status === s)}>
              {humanize(s)}
            </Link>
          ))}
        </div>
        <div className="flex gap-2">
          <Link href={buildHref({ sort: 'votes', page: 1 })} className={tabClasses(sort === 'votes')}>
            Most voted
          </Link>
          <Link href={buildHref({ sort: 'new', page: 1 })} className={tabClasses(sort === 'new')}>
            Newest
          </Link>
        </div>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title="No ideas here yet"
          description="Be the first to submit an idea for this board."
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <li
              key={item.id}
              className="flex gap-4 rounded-lg border border-gray-200 bg-white px-4 py-4"
            >
              <VoteButton slug={slug} itemId={item.id} initialVoteCount={item.vote_count} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">{item.title}</h2>
                  <Badge status={item.status} />
                </div>
                {item.description && (
                  <p className="mt-1 line-clamp-3 text-sm text-gray-600">{item.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  {item.category && <span>{item.category}</span>}
                  <span>{dateFormatter.format(new Date(item.created_at))}</span>
                  {item.submitted_by_name && <span>by {item.submitted_by_name}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <BoardPagination page={data.page} perPage={data.per_page} total={data.total} />
      </div>
    </div>
  );
}
