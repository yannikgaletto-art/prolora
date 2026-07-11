// Motion primitives (GOAL-RUN5 D5) — `motion` (v12, motion/react) is the
// project's animation standard from here on: interactive elements use these
// presets, no ad-hoc CSS keyframes for micro-interactions (Frontend-Bible §4.1).
// Values follow the Bible's canonical springs; keep them boring and reuse them.

export const motionSpring = {
  /** Tactile, responsive — buttons, cards, chips. */
  snappy: { type: 'spring', stiffness: 400, damping: 25 } as const,
  /** Gentle — layout shifts, expanding details. */
  gentle: { type: 'spring', stiffness: 160, damping: 24 } as const,
};

export const motionDurations = {
  fast: 0.12,
  normal: 0.2,
} as const;

/** Step-transition preset (fade + small y) — reduced-motion drops the movement. */
export function stepTransition(reduced: boolean | null) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: motionDurations.normal },
  };
}
