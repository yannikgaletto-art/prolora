export default function ListenLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-80 animate-pulse rounded bg-gray-100" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
        ))}
      </div>

      <div className="h-20 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      <div className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
