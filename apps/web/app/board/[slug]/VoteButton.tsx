'use client';

import { useState } from 'react';
import { ApiClientError, errorMessage, fetchApi } from '@/app/lib/api';

export interface VoteButtonProps {
  slug: string;
  itemId: string;
  initialVoteCount: number;
}

// Optimistic vote (F5-2, Oracle 6): POSTs to
// /v1/boards/:slug/items/:id/vote. Dedup is enforced server-side by request
// fingerprint (IP + user-agent hash) — a repeat vote comes back 409, and the
// optimistic increment is rolled back.
export function VoteButton({ slug, itemId, initialVoteCount }: VoteButtonProps) {
  const [voteCount, setVoteCount] = useState(initialVoteCount);
  const [voted, setVoted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVote() {
    if (pending || voted) return;
    setPending(true);
    setError(null);
    setVoteCount((count) => count + 1);
    try {
      const result = await fetchApi<{ vote_count: number }>(
        `/v1/boards/${slug}/items/${itemId}/vote`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setVoteCount(result.vote_count);
      setVoted(true);
    } catch (err) {
      setVoteCount((count) => count - 1);
      if (err instanceof ApiClientError && err.status === 409) {
        setVoted(true);
        setError('Already voted');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleVote}
        disabled={pending || voted}
        aria-pressed={voted}
        aria-label={voted ? 'Already voted' : 'Vote for this idea'}
        className={`flex h-12 w-12 flex-col items-center justify-center rounded-md text-sm font-semibold ring-1 ring-inset transition-colors ${
          voted
            ? 'bg-primary-50 text-primary-700 ring-primary-200'
            : 'bg-white text-gray-700 ring-gray-300 hover:bg-primary-50 hover:text-primary-700 hover:ring-primary-200'
        } disabled:cursor-not-allowed`}
      >
        <span aria-hidden="true">▲</span>
        <span>{voteCount}</span>
      </button>
      {error && <span className="text-xs text-gray-500">{error}</span>}
    </div>
  );
}
