'use client';

// Tap-to-expand decision card (GOAL-RUN5 design spec S1–S3). Shared by all
// three wizard choice steps: tapping the card is the explanation moment
// (user feedback #3 — "wenn ich anklicke, wird mir erklärt"), the action
// inside the detail is the actual decision. Text-first, no icon grids.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionDurations } from './motion';

export interface ChoiceCardProps {
  title: string;
  subtitle?: string;
  /** Right-aligned chips (format badge, platform dots). */
  meta?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /** Detail content shown when expanded — bullets, benchmarks, CTA. */
  children: ReactNode;
}

export function ChoiceCard({ title, subtitle, meta, expanded, onToggle, children }: ChoiceCardProps) {
  const detailId = useId();
  const reduced = useReducedMotion();

  return (
    <div
      className={`rounded-lg border transition-colors ${
        expanded
          ? 'border-primary-600 bg-primary-50/40'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-start justify-between gap-3 rounded-lg px-4 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{title}</span>
          {subtitle && <span className="mt-0.5 block text-sm text-gray-500">{subtitle}</span>}
        </span>
        {meta && <span className="flex shrink-0 items-center gap-1.5">{meta}</span>}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`mt-0.5 h-5 w-5 shrink-0 text-gray-400 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={detailId}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: motionDurations.normal }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-4 pb-4 pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
