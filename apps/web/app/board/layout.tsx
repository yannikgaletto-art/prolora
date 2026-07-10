import type { ReactNode } from 'react';

// Public board chrome (F5-2): deliberately minimal — no AppShell, no sidebar,
// no auth check. This tree sits outside the (dashboard) route group and
// outside middleware's auth gate (see middleware.ts's PUBLIC_BOARD regex).
export default function BoardLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}
