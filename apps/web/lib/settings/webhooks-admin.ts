'use server';

// F6 Settings: app/api/v1/webhooks/route.ts only exports GET (list) and POST
// (create) — there is no DELETE route for a single webhook, and the
// guardrails forbid touching that existing route file. Delete runs the same
// way the api-keys Server Actions do: straight against the service-role db,
// workspace-scoped, no new route file. List/create still go through the real
// route via fetchApi in the client island.

import { getServiceDb } from '@/lib/db';
import { assertOwnWorkspace } from './workspace-guard';

export async function deleteWebhook(workspaceId: string, webhookId: string): Promise<void> {
  const wsId = await assertOwnWorkspace(workspaceId);
  const db = getServiceDb();
  const { error } = await db.from('webhooks').delete().eq('id', webhookId).eq('workspace_id', wsId);
  if (error) {
    throw new Error(`[settings/webhooks-admin] delete failed: ${error.message}`);
  }
}
