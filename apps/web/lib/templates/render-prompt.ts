// Prompt builder (GOAL-RUN4 T1-3): merges the template layers (style preset,
// psych levels, CTA mechanic, platform nuances) into one system/user prompt.
// Two rules are enforced in CODE, not by asking the model (Oracle 6):
// Mastodon targets strip comment_trigger/dm_invite CTAs, and link placement
// is decided per platform (LinkedIn -> first_comment, X/Telegram -> inline).
import type { CtaMechanic, PlatformType, PostTemplate, PsychLevel, StylePreset } from '@prolora/shared';
import type { WorkspaceContextRow } from '@/lib/db';
import { getPlatformRules } from '@/lib/validation/platform-rules';

// Exported for the splinter engine (GOAL-RUN6) — one source of truth.
export const STYLE_PRESET_RULES: Record<StylePreset, string> = {
  neutral: 'No style overlay — follow the workspace voice tone.',
  hormozi_carousel:
    'Playbook carousel style: slide 1 = bold claim (max 8 words), slide 2 = proof (number/reference — ' +
    'proof beats promise), then exactly ONE framework step per slide (rule + one sentence of reasoning), ' +
    'last slide = quotable one-liner + CTA. Maximum 10 slides. Short sentences, no adjective filler, ' +
    'every statement backed by a number or example. Return the slides in the "slides" array and a ' +
    'separate 2-3 sentence caption (+ CTA) as "content".',
  ai_automation_screencast:
    'AI-automation creator style: slides[0] = one static overlay sentence for a 5-7s screen-recording ' +
    'loop (pattern: "Wie dieser unauffällige [Workflow] mir wöchentlich [X Stunden] [Aufgabe] abnimmt"). ' +
    '"content" = the value caption: result hook with a time/money number, then 3-5 bullets of what the ' +
    'workflow does (trigger -> processing -> output), the stack, ONE honest limitation, then the CTA.',
  doku_modus:
    'Documentation mode ("look over my shoulder"): unfiltered, small, concrete. 3-6 sentences, no ' +
    'marketing sentence patterns, numbers and rough edges stay in. No hard CTA — authenticity is the mechanic.',
};

const PSYCH_LEVEL_RULES: Record<PsychLevel, string> = {
  rational:
    'Rational angle: concrete numbers, steps, time/money saved. Back every claim with a verifiable detail. No adjective chains.',
  emotional:
    'Emotional angle: first-person narration, one concrete moment (time, place, feeling), tension arc from frustration to relief. Leave rough edges in.',
  social:
    'Social angle: belonging ("wir", name the peer group), proof through others (quotes, third-party results). Trust transfers person to person, never brand to person.',
};

// Condensed platform nuance blocks from GOAL-RUN4 Appendix A.5, including the
// per-platform intensity dial (hook hardness, FOMO, CTA pressure).
// Exported for the splinter engine (GOAL-RUN6) — one source of truth.
export const PLATFORM_NOTES: Record<PlatformType, string> = {
  linkedin:
    'LinkedIn (intensity: full): the first 2-3 lines sit above the "...more" fold and must carry the ' +
    'post — dwell time is the core metric. Short paragraphs. 3-5 topical hashtags at the end. External ' +
    'links belong in the first comment, never in the post. Comment triggers only as an honest offer ' +
    'with a real asset — LinkedIn suppresses low-effort engagement bait via NLP classifiers; genuine ' +
    'discussion questions are safe.',
  x:
    'X (intensity: full): one thought per post, hook carries everything, no "🧵 thread" cliché. ' +
    'Standard CTA: follow + repost. Links may go directly into the post (the link penalty was removed in Oct 2025).',
  bluesky:
    'Bluesky (intensity: reduced): conversational community tone, participation over broadcast, no ' +
    'CTA stacking, sparse hashtags, no marketing phrasing. Links are fine. Note: length counts in graphemes.',
  mastodon:
    'Mastodon (intensity: minimal — HARD RULES): no advertising language, no growth mechanics, no ' +
    'comment triggers or DM invites, no superlatives, no FOMO scarcity. Honest, factual, nerdy wins. ' +
    '1-3 specific hashtags, multi-word tags in CamelCase (screen-reader convention). Distribution is ' +
    'chronological and human-boost only — the post must earn its place.',
  telegram:
    'Telegram (intensity: direct): push channel without a feed algorithm — subscribers see everything, ' +
    'completeness beats hooks. Long form is fine. Links go directly into the post. Direct CTAs are acceptable; ' +
    'exclusivity ("Telegram-only") is the reason people subscribe.',
};

function ctaInstruction(
  mechanic: CtaMechanic,
  targets: PlatformType[],
  slots: Record<string, string>
): string {
  // Invariante-D1-Geist + A.5: Mastodon among the targets neutralizes
  // engagement-mechanic CTAs in code — an open question replaces them.
  const mastodonTargeted = targets.includes('mastodon');
  if (mastodonTargeted && (mechanic === 'comment_trigger' || mechanic === 'dm_invite')) {
    return (
      'CTA: end with ONE genuine open question to the readers instead of any comment-trigger or ' +
      'DM mechanic (Mastodon is among the targets — engagement mechanics are culturally hostile there).'
    );
  }

  switch (mechanic) {
    case 'comment_trigger': {
      const trigger = slots.triggerwort?.trim();
      const asset = slots.asset?.trim();
      return (
        `CTA: comment trigger. Ask readers to comment the trigger word ${
          trigger ? `"${trigger.toUpperCase()}"` : '(pick ONE short German word, UPPERCASE)'
        } to receive ${asset ? `"${asset}"` : 'the promised asset'} via DM. Phrase it as an honest ` +
        'offer with a real asset, never as engagement bait ("Kommentiere JA" patterns get suppressed). ' +
        'Briefly justify why it comes via DM.'
      );
    }
    case 'save_cta':
      return 'CTA: save-CTA — tell readers to save the post and name the concrete occasion they will need it for.';
    case 'link_in_comment': {
      const link = slots.link?.trim();
      if (!link) {
        return 'CTA: point to a specific next step without a link (no link was provided).';
      }
      // Link placement is a per-platform switch (research correction #1):
      // LinkedIn punishes in-post links; X/Telegram/Bluesky do not.
      return targets.includes('linkedin')
        ? `CTA: the link ${link} must NOT appear in "content". Write "first_comment" as: the link plus ONE context sentence.`
        : `CTA: place the link ${link} directly in the post with one context sentence (no in-post link penalty on these platforms).`;
    }
    case 'poll':
      return (
        'CTA: poll as text — 2-4 clearly distinct options formatted as "A) ... B) ... C) ...", one of them ' +
        'with friction, plus a "Sonstiges -> ab in die Kommentare" option and the promise to share the result.'
      );
    case 'dm_invite':
      return 'CTA: invite readers to send a direct message with ONE short keyword.';
    case 'none':
      return 'CTA: none or at most one soft open question — a hard CTA would destroy this post type.';
  }
}

export interface TemplatePromptInput {
  template: PostTemplate;
  /** Slot values after workspace-context prefill. */
  slots: Record<string, string>;
  targetPlatforms: PlatformType[];
  context: WorkspaceContextRow | null;
}

export interface TemplatePrompt {
  system: string;
  user: string;
  characterBudget: number;
  /** Platform whose limit produced the budget — decides the count mode. */
  budgetPlatform: PlatformType;
}

export function buildTemplatePrompt(input: TemplatePromptInput): TemplatePrompt {
  const { template, slots, targetPlatforms, context } = input;

  let characterBudget = Number.POSITIVE_INFINITY;
  let budgetPlatform: PlatformType = targetPlatforms[0];
  for (const platform of targetPlatforms) {
    const limit = getPlatformRules(platform).max_text_length;
    if (limit < characterBudget) {
      characterBudget = limit;
      budgetPlatform = platform;
    }
  }

  const language = context?.voice_language?.trim() || 'de';
  const tone = context?.voice_tone?.trim() || 'casual';

  const wantsSlides =
    template.format === 'carousel_pdf' || template.style_preset === 'ai_automation_screencast';

  const system = [
    'You are a social media ghostwriter for the DACH B2B market. You draft ONE post from a curated',
    'template. Return the result ONLY via the template_draft tool.',
    '',
    `Output language: ${language}. Workspace voice tone: ${tone}.`,
    `Style preset: ${STYLE_PRESET_RULES[template.style_preset]}`,
    '',
    'Psychological angle (primary first):',
    ...template.psych_levels.map((level) => `- ${PSYCH_LEVEL_RULES[level]}`),
    '',
    'Target platforms and their rules:',
    ...targetPlatforms.map((p) => `- ${PLATFORM_NOTES[p]}`),
    '',
    `Hard length budget for "content": ${characterBudget} characters (tightest target platform: ${budgetPlatform}).`,
    'Hook quality check (4U): the first line must satisfy at least 3 of 4 — useful, urgent, unique, ultra-specific.',
    wantsSlides
      ? 'This template produces "slides" — fill the slides array as instructed by the style preset.'
      : 'Do not return slides for this template.',
  ].join('\n');

  const answeredSlots = template.slots
    .map((slot) => {
      const value = slots[slot.key]?.trim();
      return value ? `- ${slot.question}\n  Antwort: ${value}` : null;
    })
    .filter((line): line is string => line !== null);

  const user = [
    `Template: ${template.name} (${template.post_type})`,
    '',
    'Script structure — follow this slot order:',
    ...template.structure.map((slot, i) => `${i + 1}. ${slot}`),
    '',
    'Hook formulas (pick the strongest ONE, vary it naturally, resolve all [placeholders] — never leave brackets in the output):',
    ...template.hook_formulas.map((h) => `- ${h}`),
    '',
    'User input:',
    ...answeredSlots,
    '',
    ...(context?.product_description ? [`Product context: ${context.product_description}`] : []),
    ...(context?.target_audience ? [`Target audience: ${context.target_audience}`] : []),
    '',
    `Template-specific instructions: ${template.prompt_hints}`,
    '',
    ctaInstruction(template.cta_mechanic, targetPlatforms, slots),
  ].join('\n');

  return { system, user, characterBudget, budgetPlatform };
}
