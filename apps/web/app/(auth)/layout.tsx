import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-primary-600" />
        <span className="text-lg font-semibold tracking-tight text-gray-900">Prolora</span>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
