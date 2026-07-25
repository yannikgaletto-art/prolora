'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionSpring, stepTransition } from '@/app/components/motion';

const TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'plan', label: 'Plan' },
  { id: 'system', label: 'System Status' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export interface SettingsTabsProps {
  workspaceTab: ReactNode;
  apiKeysTab: ReactNode;
  webhooksTab: ReactNode;
  planTab: ReactNode;
  systemTab: ReactNode;
}

// Plain buttons + state — no routing, no external tab library. Each tab's
// content is a pre-rendered node (some server-rendered, some client islands)
// passed in from the Server Component page; switching only shows/hides it.
export function SettingsTabs({ workspaceTab, apiKeysTab, webhooksTab, planTab, systemTab }: SettingsTabsProps) {
  const [active, setActive] = useState<TabId>('workspace');
  const reduced = useReducedMotion();
  const indicatorId = useId();

  const content: Record<TabId, ReactNode> = {
    workspace: workspaceTab,
    'api-keys': apiKeysTab,
    webhooks: webhooksTab,
    plan: planTab,
    system: systemTab,
  };

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            aria-current={active === tab.id ? 'page' : undefined}
            className={`relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors ${
              active === tab.id ? 'text-primary-700' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {tab.label}
            {/* layoutId lets the underline travel between tabs instead of
                cutting; one shared id, so only ever one indicator exists. */}
            {active === tab.id && (
              <motion.span
                layoutId={indicatorId}
                transition={motionSpring.snappy}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary-600"
              />
            )}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={active} {...stepTransition(reduced)}>
          {content[active]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
