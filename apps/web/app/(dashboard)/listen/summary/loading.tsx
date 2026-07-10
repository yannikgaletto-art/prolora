export default function ListenSummaryLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
        <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
        ))}
      </div>

      <div className="h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
        <div className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      </div>
    </div>
  );
}
