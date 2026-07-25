'use client';

// Settings-side entry point for the same connect flow the Discover dialog uses.
// A workspace that connected Reddit while mapping communities should be able to
// see, replace or revoke that credential somewhere permanent — not only inside
// a modal it may never open again.

import { useState } from 'react';
import { Card } from '@/app/components/Card';
import {
  ConnectRedditPanel,
  type RedditIntegrationStatus,
} from '@/app/components/ConnectRedditPanel';

export function RedditIntegrationCard({
  initialStatus,
}: {
  initialStatus: RedditIntegrationStatus;
}) {
  const [status, setStatus] = useState(initialStatus);

  return (
    <Card
      title="Reddit access"
      description="Community discovery and Reddit feedback read public Reddit data with your own app key."
    >
      <ConnectRedditPanel status={status} onConnected={setStatus} embedded />
    </Card>
  );
}
