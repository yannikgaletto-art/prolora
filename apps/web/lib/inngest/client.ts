import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'prolora',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type ProloraEvents = {
  'writer/run': {
    data: {
      workspaceId: string;
      mode: 'normal' | 'shadow';
      requestedBy: string;
      outputLanguages?: Array<'de' | 'en'>;
      productMentionMode?: 'adaptive' | 'include' | 'exclude';
    };
  };
  'post/publish': { data: { postItemId: string; workspaceId: string } };
  'post/published-effects': { data: { postItemId: string; workspaceId: string } };
  'post/scheduled': { data: { postGroupId: string; workspaceId: string } };
  'post/first-comment': { data: { postItemId: string; workspaceId: string; comment: string } };
  'feedback/process': { data: { rawFeedbackId: string; workspaceId: string } };
  'feedback/batch-process': { data: { workspaceId: string; limit?: number } };
  'feedback/poll': { data: { workspaceId?: string; sourceId?: string } };
  'tokens/refresh': { data: { connectionId: string; workspaceId: string } };
  'tokens/health-check': { data: { connectionId?: string } };
  // Emitted by the daily classifier (functions/connection-health.ts) when a
  // connection's derived health differs from what its `status` column says.
  'connection/health-changed': {
    data: {
      connectionId: string;
      workspaceId: string;
      platform: string;
      state: 'healthy' | 'expiring_soon' | 'expired' | 'revoked';
      previousState: 'healthy' | 'expiring_soon' | 'expired' | 'revoked';
      tokenExpiresAt: string | null;
      expiresInDays: number | null;
    };
  };
  'metrics/collect': { data: { postItemId: string; workspaceId: string } };
  'webhooks/fire': { data: { workspaceId: string; event: string; payload: Record<string, unknown> } };
  'digest/daily': { data: { workspaceId: string } };
  'board/notify-voters': { data: { boardItemId: string; newStatus: string } };
  'discovery/thread-radar': { data: { communityId: string; workspaceId: string } };
  'discovery/community-health': { data: { workspaceId: string } };
  'discovery/opportunity-expiry': { data: { workspaceId: string } };
  'discovery/optimal-timing': { data: { workspaceId: string; platform: string } };
  'media/generate': { data: { generationId: string; workspaceId: string } };
};
