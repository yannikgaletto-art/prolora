import type { DraftResponse, VoiceConfig } from '@prolora/shared';
import { CREDIT_COSTS } from '@prolora/shared';
import {
  getServiceDb,
  type DiscoveryCommunityRow,
  type OpportunityThreadRow,
  type ResponseMapRow,
  type VoiceConfigRow,
} from '@/lib/db';
import { draftReply } from '@/lib/ai/draft-reply';
import { getWorkspaceContext } from './auto-context';
import { checkCooldown } from './cooldown-tracker';
import { ApiError } from '@/lib/api/http';

// POST /discover/draft: loads all context (thread, community rules, voice,
// Response Map few-shots), generates a compliant draft and stores it on the
// opportunity. The user copies & posts it THEMSELVES (Invariante D1).
export async function generateDraft(
  workspaceId: string,
  opportunityId: string,
  voiceOverride?: Partial<VoiceConfig>
): Promise<DraftResponse> {
  const db = getServiceDb();

  const { data: thread, error: threadError } = await db
    .from('opportunity_threads')
    .select('*')
    .eq('id', opportunityId)
    .eq('workspace_id', workspaceId)
    .maybeSingle<OpportunityThreadRow>();
  if (threadError) {
    throw new Error(`[draft-assist] opportunity lookup failed: ${threadError.message}`);
  }
  if (!thread) {
    throw new ApiError(404, 'Opportunity not found.', 'not_found');
  }

  const [community, voice, context] = await Promise.all([
    loadCommunity(workspaceId, thread.community_id, thread.community_name),
    loadVoiceConfig(workspaceId, voiceOverride),
    getWorkspaceContext(workspaceId),
  ]);

  // Response Map: proven answers with the same intent as few-shot examples.
  const responseMapEntries = await loadResponseMapEntries(workspaceId, thread.intent_type);

  const result = await draftReply({
    thread,
    community,
    voice,
    responseMapEntries,
    productContext: context?.product_description ?? '',
  });

  // Persist the draft on the opportunity (status new -> drafted).
  const { error: updateError } = await db
    .from('opportunity_threads')
    .update({
      draft_content: result.content,
      status: thread.status === 'new' ? 'drafted' : thread.status,
      response_map_match_id: responseMapEntries[0]?.id ?? null,
    })
    .eq('id', thread.id);
  if (updateError) {
    throw new Error(`[draft-assist] draft write failed: ${updateError.message}`);
  }

  // Read-back verify (Double Assurance).
  const { data: verify, error: verifyError } = await db
    .from('opportunity_threads')
    .select('draft_content')
    .eq('id', thread.id)
    .single<{ draft_content: string | null }>();
  if (verifyError || verify?.draft_content !== result.content) {
    throw new Error('[draft-assist] draft verification failed');
  }

  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'draft_reply',
    credits_used: CREDIT_COSTS.draft_reply,
    metadata: {
      opportunity_id: thread.id,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    },
  });
  if (usageError) {
    console.error('[draft-assist] usage log failed:', usageError.message);
  }

  // Cooldown status is advisory — shown, never enforced (human decides).
  const cooldown = await checkCooldown(workspaceId, thread.community_name);
  const warnings = [...result.complianceWarnings];
  if (cooldown.warning) warnings.push(cooldown.warning);

  return {
    draft_id: thread.id,
    content: result.content,
    reasoning: result.reasoning,
    community_rules_check: {
      compliant: result.complianceWarnings.length === 0,
      warnings,
    },
    ...(result.suggestedFollowUp ? { suggested_follow_up: result.suggestedFollowUp } : {}),
  };
}

async function loadCommunity(
  workspaceId: string,
  communityId: string | null,
  communityName: string
): Promise<DiscoveryCommunityRow | null> {
  const db = getServiceDb();
  const query = db.from('discovery_communities').select('*').eq('workspace_id', workspaceId);
  const { data, error } = communityId
    ? await query.eq('id', communityId).maybeSingle<DiscoveryCommunityRow>()
    : await query.eq('community_name', communityName).maybeSingle<DiscoveryCommunityRow>();
  if (error) {
    console.error('[draft-assist] community lookup failed:', error.message);
    return null;
  }
  return data;
}

async function loadVoiceConfig(
  workspaceId: string,
  override?: Partial<VoiceConfig>
): Promise<VoiceConfigRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('voice_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('name', 'default')
    .maybeSingle<VoiceConfigRow>();
  if (error) {
    console.error('[draft-assist] voice config lookup failed:', error.message);
  }

  const base: VoiceConfigRow =
    data ?? {
      id: '',
      workspace_id: workspaceId,
      name: 'default',
      tone: 'casual',
      language: 'de',
      max_reply_length: 500,
      include_personal_experience: true,
      avoid_patterns: ['check out my tool', 'I built X', 'shameless plug'],
      example_replies: [],
      created_at: new Date().toISOString(),
    };

  if (!override) return base;
  return {
    ...base,
    ...(override.tone ? { tone: override.tone } : {}),
    ...(override.language ? { language: override.language } : {}),
    ...(override.max_reply_length ? { max_reply_length: override.max_reply_length } : {}),
    ...(override.include_personal_experience !== undefined
      ? { include_personal_experience: override.include_personal_experience }
      : {}),
    ...(override.avoid_patterns ? { avoid_patterns: override.avoid_patterns } : {}),
  };
}

async function loadResponseMapEntries(
  workspaceId: string,
  intentType: string | null
): Promise<ResponseMapRow[]> {
  if (!intentType) return [];
  const db = getServiceDb();
  const { data, error } = await db
    .from('response_map')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('intent_type', intentType)
    .gt('avg_engagement', 3)
    .order('avg_engagement', { ascending: false })
    .limit(2)
    .returns<ResponseMapRow[]>();
  if (error) {
    console.error('[draft-assist] response map lookup failed:', error.message);
    return [];
  }
  return data ?? [];
}
