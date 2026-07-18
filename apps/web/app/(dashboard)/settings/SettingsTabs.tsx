'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

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
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active === tab.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {content[active]}
    </div>
  );
}
