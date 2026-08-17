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
  welsh_short:
    'Short-and-whitespace mechanic: maximum 1-2 lines per sentence/paragraph. Open with a relatable enemy ' +
    'or familiar frustration, sharpen the tension with a short cliffhanger before the fold, then deliver one ' +
    'clear lesson. Never place a link in the post body; put it in the first comment when needed.',
  koe_pia:
    'PIA essay mechanic: structure the post as Pain → Insight → Action. Make the pain concrete, use an ' +
    'anti-vision to show what continues if nothing changes, reveal a non-obvious insight, then end with one ' +
    'specific action. Transitions must make the causal chain explicit; avoid a contrast-free sales pitch.',
  abdaal_evidence:
    'Evidence-story mechanic: begin with a concrete "How I…" transformation, show the starting state and ' +
    'measurable result, then explain the repeatable steps and supporting evidence. Separate observation from ' +
    'claim and name limitations; evidence beats inspirational assertion.',
};

export function resolveTemplateStyle(
  templateStyle: StylePreset,
  workspaceStyle: StylePreset | null | undefined
): StylePreset {
  return templateStyle === 'neutral' && workspaceStyle && workspaceStyle !== 'neutral'
    ? workspaceStyle
    : templateStyle;
}

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
  discord:
    'Discord (intensity: reduced): concise community-native update, conversational tone, no mass mentions or broadcast spam.',
  devto:
    'Dev.to (long-form): first line is the article title, followed by useful Markdown with concrete examples for developers.',
  hashnode:
    'Hashnode (long-form): first line is the article title, followed by a technically rigorous Markdown article for practitioners.',
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
  /** GOAL-RUN9 D6: minimum length for longform drafts (~60% of budget). */
  lengthFloor: number | null;
  /** True when a longform template fell back to punchy mode (budget < 1500). */
  longformFallback: boolean;
  /** Targets whose own limit is below the lead-channel budget (need per-platform adaptation). */
  narrowerTargets: PlatformType[];
}

// D6: below this budget a narrative arc physically cannot unfold — the
// longform template auto-falls back to punchy mode and the UI says so.
export const LONGFORM_MIN_BUDGET = 1500;
export const LONGFORM_FLOOR_RATIO = 0.6;

// D6 revision: a draft used to be written for the TIGHTEST target, so one X
// target (280) collapsed a six-part LinkedIn structure into a tweet. The draft
// is now written for the LEAD channel (widest limit); narrower targets get
// their own shortened version through the existing per-platform adaptation
// (lib/ai/adapt-content.ts). Single-target drafts are unaffected.
// Punchy templates get a floor too — an LLM with only a ceiling always writes
// short. Slide templates are exempt: their "content" is just the caption.
export const PUNCHY_FLOOR_RATIO = 0.35;

// Story-arc rules (GOAL-RUN9 §5 resonance schema). Replaces the punchy
// "Structure" subsection for longform templates — Voice/Tension/Anti-pattern
// rules stay shared, they are not duplicated.
// RUN11 (17.08.): destilliert aus dem Pathly COVER_LETTER_REGELWERK §7 —
// dieselben Marker, die ein Anschreiben als KI entlarven, entlarven auch Posts.
// Zentral hier, damit Template-Drafts UND One-Path-Konzepte identisch schreiben.
// Exported for the concept engine — one source of truth.
export const ANTI_AI_MARKER_RULES: string[] = [
  '--- ANTI-AI MARKERS (hard bans — one violation ruins the post) ---',
  '- BANNED pattern family "nicht nur X, sondern Y" / "kein X, sondern Y" — the most common AI tell.',
  '- BANNED negation enumerations: "Es war kein A, keine B, kein C." Say what it WAS, directly.',
  '- BANNED echo constructs: "Das fühlt sich X an. Und das ist es auch."',
  '- BANNED universal maxims ("Erfolg entsteht, wenn…"). Use an Ich anchor instead: "Ich habe gelernt, dass…".',
  '- BANNED insight clichés: "wurde mir klar", "öffnete mir die Augen", "Die Frage lautet…".',
  '- BANNED fillers: "wirklich", adjectival "echt" ("echter Mehrwert"), "game-changer", "🚀 Exciting news".',
  '- No em-dashes (—) as a rhythm device. Use periods.',
  '- Write like a voice message to a friend: colloquial, warm, direct. Openers like',
  '  "Hey Leute, ich hatte gerade wieder…" or "Kurze Frage: wie viele von euch…" are the register.',
  '- Sentence length: max ~15 words. One thought per sentence. If a sentence needs a comma pause, split it.',
  '- Insight stays embedded in the story — never a detached "Lesson learned:" line.',
  '- The three concepts must open with three DIFFERENT moves (scene / number / question / observation) — never the same opener twice.',
  '--- END ANTI-AI MARKERS ---',
];

// Value-first formats (Nutzer-Vorgabe 17.08. + Research: Tipps, Experience-Story,
// Wendung — ergänzt um belegte Standard-Formate aus dem Creator-Playbook).
// Vertrauen entsteht durch Value: ~7 Value-Posts pro 1 Produkt-Link (mention.ts).
export const VALUE_FORMATS: string[] = [
  'Tipps & Tricks: 2-3 concrete, immediately usable steps from real work — no theory.',
  'Experience story: what happened, what went wrong, and the better way you found.',
  'Wendung (twist): it started as X, then flipped — the turn IS the value.',
  'Behind the scenes: an honest look at how it is actually built/decided, rough edges included.',
  'Myth-busting: a common piece of advice, disproven with your own evidence.',
  'Vorher/Nachher: one concrete number or state before and after, plus what changed it.',
  'Nutzer-/Leser-Story: someone else\'s real result, told with permission and specifics.',
  'Mini-Anleitung: a short how-to the reader can apply today, scoped to one narrow problem.',
];

const STRUCTURE_RULES_PUNCHY = [
  'Structure:',
  '- Max. 1–2 lines per paragraph. Whitespace between thoughts. No wall of text.',
  '- Every sentence must earn its place — if removing it does not weaken the post, cut it.',
  '- Open with the STRONGEST line. No warming up, no "Stell dir vor…", no throat-clearing.',
];

const STRUCTURE_RULES_LONGFORM = [
  'Structure (long-form narrative — this template tells ONE true story):',
  '- Narrative arc, in this order: beweisbarer Ausgangspunkt → Bruch/Spannung → unerwarteter Befund → Mechanismus (warum) → konkrete Handlungsregel → Reibungsfrage.',
  '- Short paragraphs (1–3 lines) with whitespace — long post, never wall of text.',
  '- Open with the STRONGEST line; the first 2-3 lines must carry the post above the fold.',
  '- Curate, do not compress: pick the ~10 strongest concrete details from the raw material and let them breathe.',
  '- ANTI-FABRICATION (hard rule): use ONLY details from the user input and product context below. If the material is thin, write a SHORTER honest post — never invent people, numbers or events to fill length.',
];

export function buildTemplatePrompt(input: TemplatePromptInput): TemplatePrompt {
  const { template, slots, targetPlatforms, context } = input;

  // Lead channel = widest limit among the targets (see PUNCHY_FLOOR_RATIO note).
  // The API guarantees at least one target (validation.ts .min(1)); the fallback
  // keeps a direct caller from ending up with a 0-character budget, which would
  // truncate every draft to nothing.
  const platforms: PlatformType[] = targetPlatforms.length > 0 ? targetPlatforms : ['linkedin'];
  let characterBudget = 0;
  let budgetPlatform: PlatformType = platforms[0];
  for (const platform of platforms) {
    const limit = getPlatformRules(platform).max_text_length;
    if (limit > characterBudget) {
      characterBudget = limit;
      budgetPlatform = platform;
    }
  }
  const narrowerTargets = platforms.filter(
    (platform) => getPlatformRules(platform).max_text_length < characterBudget
  );

  const language = context?.voice_language?.trim() || 'de';
  const tone = context?.voice_tone?.trim() || 'casual';
  const effectiveStyle = resolveTemplateStyle(template.style_preset, context?.creator_style);

  const wantsSlides =
    template.format === 'carousel_pdf' || template.style_preset === 'ai_automation_screencast';

  const wantsLongform = template.narrative === 'longform';
  const longform = wantsLongform && characterBudget >= LONGFORM_MIN_BUDGET;
  const longformFallback = wantsLongform && !longform;
  // Slide templates keep "content" as a short caption — a floor would inflate it.
  const lengthFloor = wantsSlides
    ? null
    : Math.floor(characterBudget * (longform ? LONGFORM_FLOOR_RATIO : PUNCHY_FLOOR_RATIO));

  const system = [
    'You are a social media ghostwriter for the DACH B2B market. You draft ONE post from a curated',
    'template. Return the result ONLY via the template_draft tool.',
    '',
    `Output language: ${language}. Workspace voice tone: ${tone}.`,
    `Style preset: ${STYLE_PRESET_RULES[effectiveStyle]}`,
    '',
    'Psychological angle (primary first):',
    ...template.psych_levels.map((level) => `- ${PSYCH_LEVEL_RULES[level]}`),
    '',
    '--- WRITING QUALITY (non-negotiable, applies to every template) ---',
    ...(longform ? STRUCTURE_RULES_LONGFORM : STRUCTURE_RULES_PUNCHY),
    '',
    ...ANTI_AI_MARKER_RULES,
    '',
    'Voice:',
    '- First-person with real stakes. "Ich habe…", "Mir ist aufgefallen…", "Das hat mich…".',
    '- NO generic advice language: "Es ist wichtig", "Man sollte", "Viele unterschätzen".',
    '- NO empty transitions: "Aber das ist noch nicht alles", "Was viele nicht wissen ist".',
    '- NO adjective stacking. ONE specific detail beats three vague adjectives.',
    '- Concrete > abstract: a number, a name, a date, a situation — not a concept.',
    '',
    'Tension:',
    '- Build information asymmetry: the reader must feel they are learning something non-obvious.',
    '- Contrast patterns carry posts: "Nicht X. Sondern Y." / "X können viele. Y können wenige."',
    '- If the post could have been written by anyone without the user\'s specific experience, it is too generic. Rewrite.',
    '',
    'Anti-patterns (if you catch yourself writing these, stop and rewrite):',
    '- Feature lists disguised as posts ("Unser Tool kann X, Y, Z")',
    '- Motivational fluff without evidence ("Einfach machen!", "Der Schlüssel ist Mindset")',
    '- Posts that announce what they will say instead of saying it ("In diesem Post zeige ich euch…")',
    '- Rhetorical questions as hooks ("Kennst du das Gefühl…?", "Hast du dich je gefragt…?")',
    '- Bullet-point dumps without narrative arc (lists need a hook, a build-up, and a payoff)',
    '--- END WRITING QUALITY ---',
    '',
    'Target platforms and their rules:',
    ...targetPlatforms.map((p) => `- ${PLATFORM_NOTES[p]}`),
    '',
    `Hard length budget for "content": ${characterBudget} characters (lead channel: ${budgetPlatform}).`,
    ...(narrowerTargets.length > 0
      ? [
          `Write the full version for ${budgetPlatform}. Do NOT shrink it to fit ${narrowerTargets.join(
            ', '
          )} — those channels get their own shortened version later. Writing for the smallest channel ` +
            'would waste the space the lead channel gives you.',
        ]
      : []),
    ...(lengthFloor !== null
      ? [
          `Length target: aim for ${lengthFloor}–${characterBudget} characters${
            longform ? ' — this is a long-form story' : ''
          }. Deliver every part of the script structure below; a draft that stops after the first two ` +
            'sections is incomplete. Under the floor is only acceptable when the raw material is ' +
            'genuinely too thin (anti-fabrication wins over length).',
        ]
      : []),
    ...(longformFallback
      ? [
          'NOTE: this is a long-form template, but the tightest target platform cannot hold a story — ' +
            'write the sharpest SHORT version of the same core insight instead (punchy mode).',
        ]
      : []),
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

  return {
    system,
    user,
    characterBudget,
    budgetPlatform,
    lengthFloor,
    longformFallback,
    narrowerTargets,
  };
}
