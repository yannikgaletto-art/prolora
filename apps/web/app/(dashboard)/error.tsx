'use client';

import { useEffect } from 'react';
import { Button } from '@/app/components/Button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard] render failed:', error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
      <h1 className="text-sm font-semibold text-red-900">This page could not be loaded</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-700">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div className="mt-5">
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
