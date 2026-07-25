'use client';

// Settings-side home for every integration the Discover dialog can also connect.
// A workspace that connected something while mapping communities must be able to
// see, replace or revoke it somewhere permanent — not only inside a modal it may
// never open again.
//
// Rendered from the registry: this file lists no provider by name, so a new
// provider shows up here without an edit.

import { useState } from 'react';
import { Card } from '@/app/components/Card';
import {
  ConnectProviderPanel,
  type ProviderIntegrationStatus,
} from '@/app/components/ConnectProviderPanel';
import { getProviderDescriptor } from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

export interface ProviderCardEntry {
  provider: IntegrationProvider;
  status: ProviderIntegrationStatus;
}

export function IntegrationsCard({ initial }: { initial: ProviderCardEntry[] }) {
  const [entries, setEntries] = useState(initial);

  return (
    <Card
      title="Discovery platforms"
      description="Where Prolora looks for communities and threads. Two of them work without any setup."
    >
      <div className="space-y-4">
        {entries.map((entry) => {
          const descriptor = getProviderDescriptor(entry.provider);
          return (
            <div key={entry.provider}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{descriptor.label}</p>
                <p className="text-xs text-gray-500">{descriptor.summary}</p>
              </div>
              <ConnectProviderPanel
                provider={entry.provider}
                status={entry.status}
                embedded
                onConnected={(status) =>
                  setEntries((current) =>
                    current.map((item) =>
                      item.provider === entry.provider ? { ...item, status } : item
                    )
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
