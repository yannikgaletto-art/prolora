'use client';

// The platform row above the community grid. It exists so that "what can this
// workspace actually search right now" is visible without opening a dialog —
// and so the two credential-free platforms are the first thing a new workspace
// sees, rather than a setup wall.
//
// Client-only for the staggered entrance (per-index, reduced-motion aware); the
// data itself still comes from the Server Component (Pfad A).

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { Badge } from '@/app/components/Badge';
import { listItemTransition } from '@/app/components/motion';
import { getProviderDescriptor } from '@/lib/integrations/registry';
import type { DiscoveryProviderStatus } from '@/lib/discovery/providers';

const SETUP_HINTS: Record<string, string> = {
  connect_reddit_first: 'Add your Reddit app in Settings',
  connect_bluesky_first: 'Connect Bluesky under Channels',
};

export function ProviderStrip({ providers }: { providers: DiscoveryProviderStatus[] }) {
  const reduced = useReducedMotion();

  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider, index) => {
        const descriptor = getProviderDescriptor(provider.provider);
        const hint = provider.reason ? SETUP_HINTS[provider.reason] : null;

        return (
          <motion.div
            key={provider.provider}
            {...listItemTransition(reduced, index)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              provider.available
                ? 'border-green-200 bg-green-50 text-green-900'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            <span className="font-medium">{descriptor.label}</span>
            {provider.available ? (
              descriptor.credentialKind === 'none' && <Badge tone="green">No setup</Badge>
            ) : provider.deepLink ? (
              <Link
                href={provider.deepLink}
                className="underline underline-offset-2 hover:text-gray-900"
              >
                {hint ?? 'Set up'}
              </Link>
            ) : (
              <span>{hint ?? 'Setup required'}</span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
