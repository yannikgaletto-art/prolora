// Splinter engine (GOAL-RUN6 §12 — Owned-Media-Flywheel). One pillar input
// (long-form text / dictated memo / imported blog post) is split into several
// STRUCTURALLY different channel-native drafts:
//   - Welsh 1-3-5: extract 3 core ideas, splinter each into distinct formats
//     (carousel + value post + short doc-mode + numbers post — not tone
//     variants of one message).
//   - PIA + 4A labels on every suggestion: the framework that explains WHY a
//     splinter works is part of the output (transparency over black-box AI —
//     "ehrliche Benchmarks" ethos).
//   - Style grounding: the workspace voice config + recent published posts
//     anchor the drafts in the user's actual voice, not generic LLM prose.
//     (pgvector-RAG over past top posts is the planned upgrade; plain
//     recency grounding ships first. See GOAL-RUN6 §12.)
// Human-in-the-loop by design: the engine returns SUGGESTIONS. Accepting one
// creates a normal draft post_group — nothing ever auto-publishes (FABLE-04/05).
import {
  CREDIT_COSTS,
  type PlatformType,
  type PostTemplate,
  type SplinterFramework4A,
  type SplinterSuggestion,
  type StylePreset,
} from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { assertCreditQuota } from '@/lib/usage/credits';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { PLATFORM_NOTES, STYLE_PRESET_RULES } from '@/lib/templates/render-prompt';
import { getPlatformRules } from '@/lib/validation/platform-rules';

const MAX_PILLAR_CHARS = 24_000;
const MAX_SPLINTERS = 6;
const GROUNDING_POSTS = 5;
const FRAMEWORKS_4A: SplinterFramework4A[] = [
  'actionable',
  'analytical',
  'aspirational',
  'anthropological',
];

export interface SplinterEngineResult {
  core_ideas: string[];
  suggestions: SplinterSuggestion[];
  warnings: string[];
  credits_used: number;
}

// Pure template selection — structurally diverse (one per format/style family),
// filtered to platforms the workspace can actually publish to. Deterministic
// and unit-tested. Falls back to the LinkedIn value set when nothing matches.
export function pickSplinterTemplates(
  activePlatforms: PlatformType[],
  catalog: PostTemplate[] = TEMPLATE_CATALOG,
  preferredStyle: StylePreset = 'neutral'
): PostTemplate[] {
  const active = new Set(activePlatforms);
  const reachable = catalog.filter((t) =>
    t.recommended_platforms.some((p) => active.has(p))
  );
  const pool = reachable.length >= 3 ? reachable : catalog;

  // Priority order encodes the 1-3-5 spread: one deep/structured piece, one
  // value text, one raw doc-mode short, one numbers-driven proof piece.
  const priorities: Array<(t: PostTemplate) => boolean> = [
    (t) => t.format === 'carousel_pdf',
    (t) => t.format === 'text' && t.intent === 'value',
    (t) => t.style_preset === 'doku_modus',
    (t) => t.post_type === 'transformation' || t.post_type === 'product_demo',
    (t) => t.format === 'poll',
  ];

  const picked: PostTemplate[] = [];
  const usedFamilies = new Set<string>();
  if (preferredStyle !== 'neutral') {
    const preferred = pool.find((template) => template.style_preset === preferredStyle);
    if (preferred) {
      picked.push(preferred);
      usedFamilies.add(`${preferred.format}:${preferred.style_preset}`);
    }
  }
  for (const matches of priorities) {
    const candidate = pool.find(
      (t) => matches(t) && !picked.includes(t) && !usedFamilies.has(`${t.format}:${t.style_preset}`)
    );
    if (candidate) {
      picked.push(candidate);
      usedFamilies.add(`${candidate.format}:${candidate.style_preset}`);
    }
    if (picked.length >= 4) break;
  }
  // Ensure at least 3 templates even on tiny pools.
  for (const t of pool) {
    if (picked.length >= 3) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

// Pure — suggested calendar spread: one splinter per day starting tomorrow,
// same core idea never on consecutive days when avoidable (Welsh: spread
// touchpoints over weeks, don't dump them in one day).
export function assignDayOffsets(suggestions: Array<{ core_idea_index: number }>): number[] {
  const offsets: number[] = [];
  let day = 0;
  let lastIdea = -1;
  for (const s of suggestions) {
    if (s.core_idea_index === lastIdea && offsets.length > 0) {
      day += 2; // put distance between same-idea variants
    }
    offsets.push(day);
    lastIdea = s.core_idea_index;
    day += 1;
  }
  return offsets;
}

export async function splinterPillar(
  workspaceId: string,
  input: { title: string | null; body: string; activePlatforms: PlatformType[] }
): Promise<SplinterEngineResult> {
  const body = input.body.trim();
  if (body.length < 200) {
    throw new ApiError(
      400,
      'Pillar content is too short to splinter — aim for at least a few paragraphs.',
      'pillar_too_short'
    );
  }
  const pillar = body.length > MAX_PILLAR_CHARS ? body.slice(0, MAX_PILLAR_CHARS) : body;

  await assertCreditQuota(workspaceId, CREDIT_COSTS.pillar_splinter);

  const context = await getWorkspaceContext(workspaceId);
  const templates = pickSplinterTemplates(
    input.activePlatforms,
    TEMPLATE_CATALOG,
    context?.creator_style
  );
  const grounding = await loadRecentPublishedPosts(workspaceId);

  const platforms = [...new Set(templates.flatMap((t) => t.recommended_platforms))].filter((p) =>
    input.activePlatforms.length > 0 ? input.activePlatforms.includes(p) : true
  );

  const language = context?.voice_language?.trim() || 'de';
  const tone = context?.voice_tone?.trim() || 'casual';

  const system = [
    'You split ONE long-form pillar text into several STRUCTURALLY DIFFERENT social posts',
    '(Welsh 1-3-5 method): first extract exactly 3 core ideas, then write one splinter per',
    'given template, each anchored to one core idea. Structural variety is the point —',
    'a carousel, a value post, a raw build-in-public note are different SHAPES, not tone',
    'variants of the same message. Return ONLY via the pillar_splinters tool.',
    '',
    `Output language: ${language}. Voice tone: ${tone}.`,
    context?.creator_style && context.creator_style !== 'neutral'
      ? `Preferred structural mechanic: ${STYLE_PRESET_RULES[context.creator_style]}`
      : 'No workspace-level structural mechanic is preferred.',
    '',
    'Label every splinter honestly:',
    '- framework_4a: which 4A angle it takes (actionable = "here is the how-to",',
    '  analytical = "here are the numbers", aspirational = "this is the goal state",',
    '  anthropological = "this is why people behave this way").',
    '- pia_note: one sentence mapping Pain -> Insight -> Action for this splinter.',
    '',
    'Platform rules for the targets:',
    ...platforms.map((p) => `- ${PLATFORM_NOTES[p]}`),
    '',
    'Hard length budgets per platform (characters):',
    ...platforms.map((p) => `- ${p}: ${getPlatformRules(p).max_text_length}`),
    '',
    grounding.length > 0
      ? [
          "Voice grounding — the user's recent published posts. Match their rhythm,",
          'vocabulary and directness; do NOT copy content from them:',
          ...grounding.map((g, i) => `<post_${i + 1}>${g}</post_${i + 1}>`),
        ].join('\n')
      : 'No past posts available — keep the voice plain and concrete, no marketing filler.',
  ].join('\n');

  const templateBriefs = templates
    .map((t, i) =>
      [
        `Template ${i + 1}: ${t.name} (id: ${t.id})`,
        `  Format: ${t.format} | Style: ${STYLE_PRESET_RULES[t.style_preset]}`,
        `  Structure: ${t.structure.join(' -> ')}`,
        `  Hook formulas (pick ONE, resolve all [placeholders]): ${t.hook_formulas.slice(0, 2).join(' | ')}`,
        `  Platform: choose ONE of ${t.recommended_platforms.filter((p) => platforms.includes(p)).join(', ') || t.recommended_platforms.join(', ')}`,
      ].join('\n')
    )
    .join('\n\n');

  const user = [
    input.title ? `Pillar title: ${input.title}` : '',
    '',
    '<pillar>',
    pillar,
    '</pillar>',
    '',
    'Write ONE splinter per template below. Distribute the 3 core ideas across them',
    '(core_idea_index 0-2). Vary the 4A angles — never give all splinters the same angle.',
    '',
    templateBriefs,
  ].join('\n');

  const client = getAnthropicClient();
  let response;
  try {
    response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [
        {
          name: 'pillar_splinters',
          description: 'Return the core ideas and the channel-native splinters',
          input_schema: {
            type: 'object' as const,
            properties: {
              core_ideas: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exactly 3 core ideas extracted from the pillar',
              },
              splinters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    template_id: { type: 'string' },
                    platform: { type: 'string' },
                    framework_4a: { type: 'string', enum: FRAMEWORKS_4A },
                    pia_note: { type: 'string' },
                    core_idea_index: { type: 'number' },
                    hook: { type: 'string' },
                    content: { type: 'string' },
                    first_comment: { type: 'string' },
                    slides: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['platform', 'framework_4a', 'pia_note', 'core_idea_index', 'hook', 'content'],
                },
              },
            },
            required: ['core_ideas', 'splinters'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'pillar_splinters' },
    });
  } catch (error) {
    console.error('[splinter] anthropic call failed:', error);
    throw new ApiError(502, 'Splinter generation is temporarily unavailable.', 'ai_unavailable');
  }

  const toolBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new ApiError(502, 'Splinter generation returned no result.', 'ai_unavailable');
  }

  const parsed = parseSplinterOutput(toolBlock.input, templates, platforms);
  const offsets = assignDayOffsets(parsed.suggestions);
  parsed.suggestions.forEach((s, i) => {
    s.suggested_day_offset = offsets[i];
  });

  // Charge only after success (draft-service pattern) — telemetry must never
  // eat the result.
  const db = getServiceDb();
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'pillar_splinter',
    credits_used: CREDIT_COSTS.pillar_splinter,
    metadata: {
      templates: templates.map((t) => t.id),
      splinters: parsed.suggestions.length,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      model: AI_MODEL,
    },
  });
  if (usageError) {
    console.error('[splinter] usage log failed:', usageError.message);
  }

  return { ...parsed, credits_used: CREDIT_COSTS.pillar_splinter };
}

// Exported for tests — tolerant parsing of the tool output: a malformed
// splinter is dropped with a warning, never a crash (R3: LLM output is
// untrusted input).
export function parseSplinterOutput(
  raw: unknown,
  templates: PostTemplate[],
  allowedPlatforms: PlatformType[]
): { core_ideas: string[]; suggestions: SplinterSuggestion[]; warnings: string[] } {
  const warnings: string[] = [];
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const coreIdeas = Array.isArray(input.core_ideas)
    ? input.core_ideas.filter((i): i is string => typeof i === 'string' && i.trim().length > 0).slice(0, 3)
    : [];
  if (coreIdeas.length === 0) {
    throw new ApiError(502, 'Splinter generation returned no core ideas.', 'ai_unavailable');
  }

  const templateIds = new Set(templates.map((t) => t.id));
  const labelByTemplate = new Map(templates.map((t) => [t.id, t.name]));
  const platformSet = new Set<string>(allowedPlatforms);

  const suggestions: SplinterSuggestion[] = [];
  const rawSplinters = Array.isArray(input.splinters) ? input.splinters : [];
  for (const entry of rawSplinters.slice(0, MAX_SPLINTERS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const platform = typeof s.platform === 'string' ? s.platform : '';
    const content = typeof s.content === 'string' ? s.content.trim() : '';
    const hook = typeof s.hook === 'string' ? s.hook.trim() : '';
    if (!content || !hook || !platformSet.has(platform)) {
      warnings.push('One splinter was dropped (missing content/hook or unknown platform).');
      continue;
    }
    const templateId =
      typeof s.template_id === 'string' && templateIds.has(s.template_id) ? s.template_id : undefined;
    const framework = FRAMEWORKS_4A.includes(s.framework_4a as SplinterFramework4A)
      ? (s.framework_4a as SplinterFramework4A)
      : 'actionable';
    const ideaIndex =
      typeof s.core_idea_index === 'number' && s.core_idea_index >= 0 && s.core_idea_index < coreIdeas.length
        ? Math.floor(s.core_idea_index)
        : 0;
    suggestions.push({
      platform: platform as PlatformType,
      template_id: templateId,
      format_label: templateId ? (labelByTemplate.get(templateId) ?? 'Post') : 'Post',
      framework_4a: framework,
      pia_note: typeof s.pia_note === 'string' ? s.pia_note.trim() : '',
      core_idea_index: ideaIndex,
      hook,
      content,
      first_comment:
        typeof s.first_comment === 'string' && s.first_comment.trim()
          ? s.first_comment.trim()
          : undefined,
      slides: Array.isArray(s.slides)
        ? s.slides.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : undefined,
      suggested_day_offset: 0, // assigned by assignDayOffsets afterwards
    });
  }

  if (suggestions.length === 0) {
    throw new ApiError(502, 'Splinter generation returned no usable splinters.', 'ai_unavailable');
  }
  return { core_ideas: coreIdeas, suggestions, warnings };
}

async function loadRecentPublishedPosts(workspaceId: string): Promise<string[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('resolved_content, published_at, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', workspaceId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(GROUNDING_POSTS)
    .returns<Array<{ resolved_content: string | null }>>();
  if (error) {
    // Grounding is an enhancement, not a dependency — degrade silently.
    console.error('[splinter] grounding query failed:', error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => row.resolved_content?.slice(0, 400) ?? '')
    .filter((s) => s.length > 0);
}
