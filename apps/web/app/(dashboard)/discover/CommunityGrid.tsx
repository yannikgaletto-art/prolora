'use client';

// Staggered entrance for the mapped-community cards. Client-only because the
// stagger is per-index and reduced-motion has to be read from the browser; the
// data itself still comes from the Server Component (Pfad A).

import { motion, useReducedMotion } from 'motion/react';
import { Badge } from '@/app/components/Badge';
import { Card } from '@/app/components/Card';
import { listItemTransition } from '@/app/components/motion';
import type { DiscoveryCommunityRow } from '@/lib/db';

const memberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' });
const scoreFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export function CommunityGrid({ communities }: { communities: DiscoveryCommunityRow[] }) {
  const reduced = useReducedMotion();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {communities.map((community, index) => (
        <motion.div
          key={community.id}
          {...listItemTransition(reduced, index)}
          whileHover={reduced ? undefined : { y: -2 }}
        >
          <Card
            title={community.community_name}
            description={community.community_url ?? undefined}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="gray">{community.platform}</Badge>
              {community.activity_level && <Badge status={community.activity_level} />}
              {typeof community.relevance_score === 'number' && (
                <Badge tone="teal">{scoreFormatter.format(community.relevance_score)} match</Badge>
              )}
              {!community.is_active && <Badge tone="gray">Inactive</Badge>}
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              <Row label="Members">
                {community.member_count != null
                  ? memberFormatter.format(community.member_count)
                  : '—'}
              </Row>
              <Row label="Language">{community.language}</Row>
              <Row label="Posts this week">{community.posts_this_week}</Row>
              <Row label="Posting cooldown">
                {community.posting_cooldown_days}{' '}
                {community.posting_cooldown_days === 1 ? 'day' : 'days'}
              </Row>
            </dl>

            {community.recommended_approach && (
              <p className="mt-4 border-t border-gray-100 pt-3 text-sm text-gray-600">
                {community.recommended_approach}
              </p>
            )}
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{children}</dd>
    </div>
  );
}
