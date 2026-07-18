import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'prolora',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type ProloraEvents = {
  'post/publish': { data: { postItemId: string; workspaceId: string } };
  'post/scheduled': { data: { postGroupId: string; workspaceId: string } };
  'post/first-comment': { data: { postItemId: string; comment: string } };
  'feedback/process': { data: { rawFeedbackId: string; workspaceId: string } };
  'feedback/batch-process': { data: { workspaceId: string; limit?: number } };
  'feedback/poll': { data: { workspaceId?: string; sourceId?: string } };
  'tokens/refresh': { data: { connectionId: string } };
  'tokens/health-check': { data: { connectionId?: string } };
  'metrics/collect': { data: { postItemId: string } };
  'webhooks/fire': { data: { workspaceId: string; event: string; payload: Record<string, unknown> } };
  'digest/daily': { data: { workspaceId: string } };
  'board/notify-voters': { data: { boardItemId: string; newStatus: string } };
  'discovery/thread-radar': { data: { communityId: string; workspaceId: string } };
  'discovery/community-health': { data: { workspaceId: string } };
  'discovery/opportunity-expiry': { data: { workspaceId: string } };
  'discovery/optimal-timing': { data: { workspaceId: string; platform: string } };
  'media/generate': { data: { generationId: string; workspaceId: string } };
};
