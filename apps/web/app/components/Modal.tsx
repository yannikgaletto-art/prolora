'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MODAL_EXIT_MS, modalPanelTransition } from './motion';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** Blocks Esc and backdrop clicks — for work that must not be lost mid-flight. */
  dismissible?: boolean;
}

// Native <dialog>: focus trap, Esc-to-close and inert background come from the
// platform. Two things the platform does NOT give us and are handled here:
//   1. Centering — Tailwind's preflight resets `margin: 0` on every element,
//      which overrides the UA's `dialog:modal { margin: auto }`. Restored in
//      globals.css; without it every modal sits in the top-left corner.
//   2. Exit animation — close() removes the element from the top layer
//      instantly, so the dialog is held open for MODAL_EXIT_MS while the panel
//      animates out (`data-closing` drives the backdrop fade from CSS).
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  // Lags `open` on the way out so the exit animation has something to run on.
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open) {
      setRendered(true);
      if (!dialog.open) dialog.showModal();
      return;
    }

    if (!dialog.open) {
      setRendered(false);
      return;
    }
    setRendered(false);
    const timer = setTimeout(() => dialog.close(), MODAL_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Esc fires 'cancel' before 'close'. Intercepting it here keeps the exit
  // animation in play (and lets a non-dismissible modal refuse to close).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible) onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose, dismissible]);

  return (
    <dialog
      ref={ref}
      data-closing={open ? undefined : 'true'}
      // Clicks land on the dialog element itself only when they hit the backdrop.
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose();
      }}
      className={`max-h-none w-[calc(100vw-2rem)] overflow-visible bg-transparent p-0 ${SIZES[size]}`}
    >
      <AnimatePresence>
        {rendered && (
          <motion.div
            {...modalPanelTransition(reduced)}
            className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="shrink-0 border-b border-gray-200 px-5 py-4 pr-12">
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
              {dismissible && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-3 top-3 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              )}
            </div>

            {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

            {footer && (
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:flex-row sm:justify-end">
                {footer}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
}
