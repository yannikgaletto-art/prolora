'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toastTransition } from './motion';

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
//
// The exit animation is self-contained: call sites render `{toast && <Toast/>}`,
// so an AnimatePresence *above* this component would never see the exit. Instead
// dismissal flips a local `visible` flag and only calls onDismiss once the
// animation has finished.
export function Toast({ variant, message, action, onDismiss }: ToastProps) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  const startDismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(startDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, startDismiss]);

  return (
    <AnimatePresence onExitComplete={onDismiss}>
      {visible && (
        <motion.div
          {...toastTransition(reduced)}
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
            onClick={startDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded p-1 text-lg leading-none opacity-60 transition-opacity hover:opacity-100"
          >
            &times;
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
