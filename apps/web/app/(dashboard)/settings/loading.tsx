export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse">
      <div className="mb-6">
        <div className="h-5 w-24 rounded bg-gray-200" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-gray-100" />
      </div>
      <div className="mb-6 flex gap-4 border-b border-gray-200 pb-2.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-4 w-16 rounded bg-gray-200" />
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-28 rounded-lg border border-gray-200 bg-gray-50" />
        <div className="h-28 rounded-lg border border-gray-200 bg-gray-50" />
      </div>
    </div>
  );
}
