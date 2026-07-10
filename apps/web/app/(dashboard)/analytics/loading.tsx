export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-80 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white px-5 py-4">
            <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
            <div className="mt-2 h-7 w-16 animate-pulse rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
              <div className="h-2 w-full animate-pulse rounded-full bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
