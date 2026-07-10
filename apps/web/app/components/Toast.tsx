'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

const AUTO_DISMISS_MS = 5000;

const VARIANTS = {
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-gray-200 bg-white text-gray-900',
} as const;

export type ToastVariant = keyof typeof VARIANTS;

export interface ToastMessage {
  variant: ToastVariant;
  message: string;
  /** Optional inline link, e.g. "View post". */
  action?: ReactNode;
}

export interface ToastProps extends ToastMessage {
  onDismiss: () => void;
}

// Owned by the page: `const [toast, setToast] = useState<ToastMessage | null>(null)`.
// No provider, no context, no global store.
export function Toast({ variant, message, action, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, message]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${VARIANTS[variant]}`}
    >
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-words">{message}</p>
        {action && <div className="mt-1.5 text-sm font-medium">{action}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded p-1 text-lg leading-none opacity-60 hover:opacity-100"
      >
        &times;
      </button>
    </div>
  );
}
