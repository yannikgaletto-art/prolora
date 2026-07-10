'use client';

import { useEffect } from 'react';

// Dedicated error boundary (F5-2): this route is outside the (dashboard)
// group so it does not inherit app/(dashboard)/error.tsx.
export default function PublicBoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[public board] render failed:', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-sm font-semibold text-gray-900">This board could not be loaded</h1>
      <p className="mt-1 text-sm text-gray-500">Please try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
      >
        Try again
      </button>
    </div>
  );
}
