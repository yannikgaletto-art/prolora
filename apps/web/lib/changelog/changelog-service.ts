import { getServiceDb, type ChangelogEntryRow } from '@/lib/db';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';

// Public field allowlist — never expose internal columns (workspace_id,
// ai_drafted, created_at) on the public changelog endpoint.
const PUBLIC_FIELDS = 'id, title, content, published_at, related_board_items';

export interface PublicChangelogEntry {
  id: string;
  title: string;
  content: string;
  published_at: string;
  related_board_items: string[] | null;
}

export interface CreateChangelogInput {
  title: string;
  content?: string;
  related_board_items?: string[];
  ai_draft?: boolean;
  publish?: boolean;
}

export interface UpdateChangelogInput {
  title?: string;
  content?: string;
  related_board_items?: string[];
  publish?: boolean;
}

// PUBLIC list: resolves the workspace via its slug, returns only published
// entries with the public field allowlist.
export async function listPublicChangelog(
  slug: string,
  page: number,
  perPage: number
): Promise<{ entries: PublicChangelogEntry[]; total: number }> {
  const db = getServiceDb();

  const { data: workspace, error: wsError } = await db
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .maybeSingle<{ id: string }>();
  if (wsError) {
    throw new Error(`[changelog] workspace lookup failed: ${wsError.message}`);
  }
  if (!workspace) {
    throw new ApiError(404, 'Unknown workspace.', 'workspace_not_found');
  }

  const from = (page - 1) * perPage;
  const { data, count, error } = await db
    .from('changelog_entries')
    .select(PUBLIC_FIELDS, { count: 'exact' })
    .eq('workspace_id', workspace.id)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .range(from, from + perPage - 1)
    .returns<PublicChangelogEntry[]>();
  if (error) {
    throw new Error(`[changelog] public list failed: ${error.message}`);
  }

  return { entries: data ?? [], total: count ?? 0 };
}

// AUTH create: optional AI draft from linked shipped board items via
// Anthropic tool-use. On LLM failure: 502, no partial insert.
export async function createChangelogEntry(
  workspaceId: string,
  input: CreateChangelogInput
): Promise<ChangelogEntryRow> {
  const db = getServiceDb();

  // related_board_items must belong to this workspace (Invariante 2).
  if (input.related_board_items && input.related_board_items.length > 0) {
    await assertBoardItemsInWorkspace(workspaceId, input.related_board_items);
  }

  let content = input.content;
  let aiDrafted = false;

  if (!content) {
    if (!input.ai_draft) {
      throw new ApiError(
        400,
        'content is required unless ai_draft=true.',
        'content_required'
      );
    }
    const items = await loadBoardItemsForDraft(workspaceId, input.related_board_items);
    if (items.length === 0) {
      throw new ApiError(
        400,
        'No shipped board items found to draft a changelog from. Provide content or related_board_items.',
        'nothing_to_draft'
      );
    }
    const drafted = await draftChangelogContent(input.title, items);
    if (!drafted) {
      throw new ApiError(
        502,
        'AI changelog drafting failed. Please retry or provide content manually.',
        'ai_draft_failed'
      );
    }
    content = drafted;
    aiDrafted = true;
  }

  const { data: inserted, error: insertError } = await db
    .from('changelog_entries')
    .insert({
      workspace_id: workspaceId,
      title: input.title,
      content,
      ai_drafted: aiDrafted,
      related_board_items: input.related_board_items ?? null,
      published_at: input.publish ? new Date().toISOString() : null,
    })
    .select('id')
    .single<{ id: string }>();
  if (insertError || !inserted) {
    throw new Error(`[changelog] insert failed: ${insertError?.message ?? 'no row'}`);
  }

  // Read-back verify (Double Assurance).
  const entry = await readBackEntry(workspaceId, inserted.id);

  // Usage log — best-effort, never blocks the response.
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'changelog_created',
    credits_used: 0,
    metadata: { changelog_id: entry.id, ai_drafted: aiDrafted, published: Boolean(input.publish) },
  });
  if (usageError) {
    console.error('[changelog] usage log failed:', usageError.message);
  }

  return entry;
}

// AUTH update: title/content/related_board_items + publish. 404 when the
// entry does not exist in this workspace.
export async function updateChangelogEntry(
  workspaceId: string,
  id: string,
  input: UpdateChangelogInput
): Promise<ChangelogEntryRow> {
  const db = getServiceDb();

  const { data: existing, error: loadError } = await db
    .from('changelog_entries')
    .select('id, published_at')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ id: string; published_at: string | null }>();
  if (loadError) {
    throw new Error(`[changelog] load failed: ${loadError.message}`);
  }
  if (!existing) {
    throw new ApiError(404, 'Changelog entry not found.', 'not_found');
  }

  if (input.related_board_items && input.related_board_items.length > 0) {
    await assertBoardItemsInWorkspace(workspaceId, input.related_board_items);
  }

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.content !== undefined) update.content = input.content;
  if (input.related_board_items !== undefined) {
    update.related_board_items = input.related_board_items;
  }
  if (input.publish === true && !existing.published_at) {
    update.published_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    // Nothing to change (e.g. publish=true on an already published entry).
    return readBackEntry(workspaceId, id);
  }

  const { error: updateError } = await db
    .from('changelog_entries')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (updateError) {
    throw new Error(`[changelog] update failed: ${updateError.message}`);
  }

  return readBackEntry(workspaceId, id);
}

async function readBackEntry(workspaceId: string, id: string): Promise<ChangelogEntryRow> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('changelog_entries')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle<ChangelogEntryRow>();
  if (error || !data) {
    throw new Error(`[changelog] read-back failed: ${error?.message ?? 'row missing'}`);
  }
  return data;
}

async function assertBoardItemsInWorkspace(
  workspaceId: string,
  boardItemIds: string[]
): Promise<void> {
  const db = getServiceDb();
  const unique = [...new Set(boardItemIds)];
  const { data, error } = await db
    .from('board_items')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', unique)
    .returns<{ id: string }[]>();
  if (error) {
    throw new Error(`[changelog] board item lookup failed: ${error.message}`);
  }
  const found = new Set((data ?? []).map((r) => r.id));
  const missing = unique.filter((bid) => !found.has(bid));
  if (missing.length > 0) {
    throw new ApiError(
      404,
      `Unknown board item(s) for this workspace: ${missing.join(', ')}`,
      'board_item_not_found'
    );
  }
}

interface DraftBoardItem {
  id: string;
  title: string;
  description: string | null;
}

// Which board items feed the AI draft: the explicitly linked ones, otherwise
// the most recently shipped items of the workspace.
async function loadBoardItemsForDraft(
  workspaceId: string,
  relatedIds?: string[]
): Promise<DraftBoardItem[]> {
  const db = getServiceDb();

  if (relatedIds && relatedIds.length > 0) {
    const { data, error } = await db
      .from('board_items')
      .select('id, title, description')
      .eq('workspace_id', workspaceId)
      .in('id', [...new Set(relatedIds)])
      .returns<DraftBoardItem[]>();
    if (error) {
      throw new Error(`[changelog] draft board items load failed: ${error.message}`);
    }
    return data ?? [];
  }

  const { data, error } = await db
    .from('board_items')
    .select('id, title, description')
    .eq('workspace_id', workspaceId)
    .eq('status', 'shipped')
    .order('shipped_at', { ascending: false })
    .limit(10)
    .returns<DraftBoardItem[]>();
  if (error) {
    throw new Error(`[changelog] shipped board items load failed: ${error.message}`);
  }
  return data ?? [];
}

// Structured changelog generation via tool-use — never free-text JSON
// parsing (Risiko R3). Returns null after 2 failed attempts.
async function draftChangelogContent(
  title: string,
  items: DraftBoardItem[]
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[changelog] ANTHROPIC_API_KEY missing — AI drafting unavailable');
    return null;
  }
  const client = getAnthropicClient();

  const itemsText = items
    .map((item, i) => `${i + 1}. ${item.title}${item.description ? ` — ${item.description.slice(0, 600)}` : ''}`)
    .join('\n')
    .slice(0, 6000);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 1500,
        system:
          'You write concise, customer-facing changelog entries for a SaaS product. ' +
          'Use clear Markdown, focus on user benefit, no internal jargon, no invented features.' +
          (attempt > 0
            ? ' STRICT MODE: your previous attempt failed validation — return a non-empty content field.'
            : ''),
        messages: [
          {
            role: 'user',
            content:
              `Write the changelog entry body (Markdown, no top-level heading) for a release titled "${title.slice(0, 200)}". ` +
              `It covers these shipped items:\n\n${itemsText}`,
          },
        ],
        tools: [
          {
            name: 'changelog_entry',
            description: 'Return the drafted changelog entry',
            input_schema: {
              type: 'object' as const,
              properties: {
                content: {
                  type: 'string',
                  description: 'Markdown body of the changelog entry',
                },
              },
              required: ['content'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'changelog_entry' },
      });

      const block = response.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('No tool_use block in draft response');
      }
      const input = block.input as Record<string, unknown>;
      if (typeof input.content !== 'string' || input.content.trim().length === 0) {
        throw new Error('Drafted content missing or empty');
      }
      return input.content.trim();
    } catch (error) {
      console.error(
        `[changelog] draft attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return null;
}
