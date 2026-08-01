'use client';

// Der geführte Faden als persistente Leiste unter der Kopfzeile.
//
// Warum eine Leiste und kein eigener Screen: das Dashboard hat 22 gleichrangige
// Ziele. Ein weiterer Screen wäre das 23. — die Leiste ist stattdessen überall
// dabei und beantwortet auf jeder Seite dieselbe Frage: "und jetzt?".
//
// Die Reihenfolge kommt aus `lib/guide/steps.ts`; diese Datei entscheidet
// nichts über Schritte, sie stellt sie nur dar.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { GuideResolution, GuideStep } from '@/lib/guide/steps';
import { formatStepOf, type GuideCopy } from '@/lib/i18n/guide';
import { ArrowRightIcon, CheckIcon, ChevronIcon } from './NavIcons';
import { motionSpring } from './motion';

const EXPANDED_KEY = 'prolora.guide.expanded';

/** Der Nutzer steht bereits auf der Seite, auf die der Schritt zeigt. */
function isOnStep(pathname: string, step: GuideStep): boolean {
  return pathname === step.href || pathname.startsWith(`${step.href}/`);
}

function StepDot({ step, index, active }: { step: GuideStep; index: number; active: boolean }) {
  if (step.done && !active) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        active
          ? step.urgent
            ? 'bg-amber-500 text-white'
            : 'bg-primary-600 text-white'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {index + 1}
    </span>
  );
}

export interface GuideBarProps {
  guide: GuideResolution;
  copy: GuideCopy;
}

export function GuideBar({ guide, copy }: GuideBarProps) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  // Wie in der AppShell: localStorage erst nach der Hydration lesen, sonst
  // widersprechen sich Server- und Client-Markup.
  useEffect(() => {
    if (window.localStorage.getItem(EXPANDED_KEY) === 'true') setExpanded(true);
  }, []);

  const toggle = () => {
    setExpanded((open) => {
      const next = !open;
      window.localStorage.setItem(EXPANDED_KEY, String(next));
      return next;
    });
  };

  const { current, position, total, complete } = guide;
  const here = isOnStep(pathname, current);
  const stepCopy = copy.steps[current.id];

  const accent = complete
    ? 'border-green-200 bg-green-50/60'
    : current.urgent
      ? 'border-amber-200 bg-amber-50/60'
      : 'border-primary-200 bg-primary-50/50';

  return (
    <div className={`border-b ${accent}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StepDot step={current} index={position - 1} active />

          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-gray-500">
              <span className="uppercase tracking-wide">
                {complete ? copy.complete_label : copy.bar_label}
              </span>
              {!complete && <span>· {formatStepOf(copy.step_of, position, total)}</span>}
              {current.urgent && !complete && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {copy.waiting_label}
                  {current.count > 1 ? ` (${current.count})` : ''}
                </span>
              )}
            </p>
            <p className="truncate text-sm font-semibold text-gray-900">
              {complete ? copy.complete_hint : stepCopy.label}
            </p>
            {!complete && <p className="truncate text-sm text-gray-600">{stepCopy.hint}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {here && !complete ? (
              <span className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                {copy.you_are_here}
              </span>
            ) : (
              <Link
                href={complete ? '/publish/start' : current.href}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  complete
                    ? 'bg-green-700 hover:bg-green-800 focus-visible:outline-green-700'
                    : current.urgent
                      ? 'bg-amber-600 hover:bg-amber-700 focus-visible:outline-amber-600'
                      : 'bg-primary-600 hover:bg-primary-700 focus-visible:outline-primary-600'
                }`}
              >
                {complete ? copy.complete_cta : stepCopy.cta}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            )}

            <button
              type="button"
              onClick={toggle}
              aria-expanded={expanded}
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              {expanded ? copy.hide_all : copy.show_all}
              <ChevronIcon
                className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`}
              />
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.ol
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={motionSpring.gentle}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-1 pt-1">
                {guide.steps.map((step, index) => {
                  const isCurrent = step.id === current.id && !complete;
                  return (
                    <li key={step.id}>
                      <Link
                        href={step.href}
                        aria-current={isCurrent ? 'step' : undefined}
                        className={`flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/70 ${
                          isCurrent ? 'font-semibold text-gray-900' : 'text-gray-600'
                        }`}
                      >
                        <StepDot step={step} index={index} active={isCurrent} />
                        <span className="min-w-0 flex-1 truncate">{copy.steps[step.id].label}</span>
                        {step.done && !isCurrent && (
                          <span className="shrink-0 text-xs text-green-700">{copy.done_label}</span>
                        )}
                        {step.urgent && !isCurrent && (
                          <span className="shrink-0 text-xs font-semibold text-amber-700">
                            {copy.waiting_label}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </div>
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
