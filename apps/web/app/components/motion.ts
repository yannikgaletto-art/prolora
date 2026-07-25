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

/** How long a modal's exit animation runs — the dialog element must stay in
 *  the top layer at least this long, so the value is shared, not guessed. */
export const MODAL_EXIT_MS = 140;

/** Modal panel: scales up from slightly small, drops back down on exit. */
export function modalPanelTransition(reduced: boolean | null) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: reduced
      ? { opacity: 0, transition: { duration: MODAL_EXIT_MS / 1000 } }
      : {
          opacity: 0,
          scale: 0.98,
          y: 6,
          transition: { duration: MODAL_EXIT_MS / 1000, ease: 'easeIn' as const },
        },
    transition: motionSpring.gentle,
  };
}

/** Toast: slides in from the right edge it is anchored to. */
export function toastTransition(reduced: boolean | null) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.96 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.96 },
    transition: motionSpring.snappy,
  };
}

/** Staggered list entrance. The delay is capped so a long list still finishes
 *  animating quickly instead of trickling in for seconds. */
export function listItemTransition(reduced: boolean | null, index: number) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: {
      ...motionSpring.gentle,
      delay: reduced ? 0 : Math.min(index, 8) * 0.035,
    },
  };
}
