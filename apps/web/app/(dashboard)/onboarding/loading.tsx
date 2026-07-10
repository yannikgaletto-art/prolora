export default function OnboardingLoading() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-primary-600" />
        <span className="text-lg font-semibold tracking-tight text-gray-900">Prolora</span>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-8 flex items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-gray-200" />
          ))}
        </div>
        <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-gray-100" />
        <div className="mt-6 space-y-3">
          <div className="h-10 w-full animate-pulse rounded-md bg-gray-100" />
          <div className="h-10 w-full animate-pulse rounded-md bg-gray-200" />
        </div>
      </div>
    </div>
  );
}
