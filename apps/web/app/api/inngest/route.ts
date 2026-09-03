import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import {
  publishPost,
  publishPostEffects,
  publishFirstComment,
  reconcileExpiredPublishing,
  processFeedback,
  batchProcessFeedback,
  pollFeedbackSources,
  refreshTokens,
  collectMetrics,
  fireWebhooks,
  notifyVoters,
  threadRadar,
  communityHealthCheck,
  optimalTiming,
  generateMedia,
  writerRun,
} from '@/lib/inngest/functions';

// Cron-triggered sweeps (publishScheduled, tokenHealthCheck,
// refreshExpiringTokens, connectionHealthMonitor, scheduledMetricsCollection,
// dailyDigest, scheduledThreadRadar, scheduledCommunityHealth,
// opportunityExpiry, pipelineStallSweep) are deliberately NOT registered
// below. isAutomationEnabled() (lib/system/kill-switch.ts) only stops the
// paid work *inside* a run — Inngest still bills/counts every cron dispatch
// regardless, which kept burning free-tier usage 24/7 while the product sat
// idle. Unregistering them here drops the schedules from Inngest on the next
// deploy sync. To bring a sweep back, re-add its import and array entry —
// the handlers themselves are untouched.
//
// reconcileExpiredPublishing stays registered: it is the only recovery path
// for a post stuck in 'publishing' after a crash (see
// reconcile_expired_post_item_claims, migration 020, and the regression test
// in writer-integrity.test.ts), it already no-ops under the kill switch like
// everything else here, and its 15-minute single-row-scan tick is cheap
// enough not to matter for the quota problem this was disabled for.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    publishPost,
    publishPostEffects,
    publishFirstComment,
    reconcileExpiredPublishing,
    processFeedback,
    batchProcessFeedback,
    pollFeedbackSources,
    refreshTokens,
    collectMetrics,
    fireWebhooks,
    notifyVoters,
    threadRadar,
    communityHealthCheck,
    optimalTiming,
    generateMedia,
    writerRun,
  ],
});
