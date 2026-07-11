// Pure wizard logic (GOAL-RUN5 G2) — no React, no DOM side effects in the
// parsing/derivation functions, so every branch is unit-testable. The URL
// carries the real decisions (?goal=&anlass=&template=); skipped steps are
// resolved here and written back with replaceState (V4.8: Back never bounces).
import type { PlatformType, PostTemplateSummary, SlotSuggestion } from '@prolora/shared';
import { anlassByKey, intentByKey, stepPlanFor, templatesFor } from '@/lib/templates/guide';
import type { GuideTemplate } from '@/lib/templates/guide';

export type WizardStep = 1 | 2 | 3 | 4;

export interface WizardState {
  step: WizardStep;
  goal?: PostTemplateSummary['intent'];
  anlassKey?: string;
  /** Anlass was auto-resolved (single option) — breadcrumb shows "automatisch". */
  anlassAutoResolved: boolean;
  templateId?: string;
  /** Step 3 has exactly one template — render it pre-expanded. */
  autoExpandTemplateId?: string;
  /** Canonical query for this state; if it differs from the URL, replaceState. */
  canonicalQuery: string;
}

export function buildQuery(parts: { goal?: string; anlass?: string; template?: string }): string {
  const params = new URLSearchParams();
  if (parts.goal) params.set('goal', parts.goal);
  if (parts.anlass) params.set('anlass', parts.anlass);
  if (parts.template) params.set('template', parts.template);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * URL → validated wizard state (D8: broken/stale params degrade to the last
 * valid step instead of crashing; unknown template ids fall back to step 1..3).
 */
export function parseWizardState(
  params: URLSearchParams,
  templates: PostTemplateSummary[]
): WizardState {
  const rawGoal = params.get('goal') ?? undefined;
  const rawAnlass = params.get('anlass') ?? undefined;
  const rawTemplate = params.get('template') ?? undefined;

  const goal = rawGoal && intentByKey(rawGoal) ? (rawGoal as WizardState['goal']) : undefined;
  if (!goal) {
    return { step: 1, anlassAutoResolved: false, canonicalQuery: buildQuery({}) };
  }

  const plan = stepPlanFor(templates as GuideTemplate[], goal, rawAnlass);
  const anlassAutoResolved = plan.skipAnlass;
  let anlassKey = plan.soleAnlassKey ?? rawAnlass;
  if (anlassKey && !anlassByKey(anlassKey)) anlassKey = undefined;
  if (anlassKey && templatesFor(templates as GuideTemplate[], goal, anlassKey).length === 0) {
    anlassKey = undefined;
  }

  if (!anlassKey) {
    return {
      step: 2,
      goal,
      anlassAutoResolved: false,
      canonicalQuery: buildQuery({ goal }),
    };
  }

  const matching = templatesFor(templates as GuideTemplate[], goal, anlassKey);
  const template = rawTemplate ? matching.find((t) => t.id === rawTemplate) : undefined;
  if (rawTemplate && !template) {
    // Stale/foreign template id → back to the template choice, never a crash.
    return {
      step: 3,
      goal,
      anlassKey,
      anlassAutoResolved,
      autoExpandTemplateId: matching.length === 1 ? matching[0]?.id : undefined,
      canonicalQuery: buildQuery({ goal, anlass: anlassKey }),
    };
  }

  if (template) {
    return {
      step: 4,
      goal,
      anlassKey,
      anlassAutoResolved,
      templateId: template.id,
      canonicalQuery: buildQuery({ goal, anlass: anlassKey, template: template.id }),
    };
  }

  return {
    step: 3,
    goal,
    anlassKey,
    anlassAutoResolved,
    autoExpandTemplateId: matching.length === 1 ? matching[0]?.id : undefined,
    canonicalQuery: buildQuery({ goal, anlass: anlassKey }),
  };
}

/** Recommended ∩ connected-active; falls back to recommended (RUN4 behavior). */
export function targetPlatformsFor(
  template: Pick<PostTemplateSummary, 'recommended_platforms'>,
  activePlatforms: ReadonlySet<PlatformType>
): PlatformType[] {
  const connected = template.recommended_platforms.filter((p) => activePlatforms.has(p));
  return connected.length > 0 ? connected : template.recommended_platforms;
}

// --- Prefill cache (T3: localStorage — survives tabs and sessions, so the
// "einmal pro Vorlage auf diesem Gerät" cost line stays true) ---

export function prefillCacheKey(workspaceId: string, templateId: string): string {
  return `prolora:prefill:${workspaceId}:${templateId}`;
}

// Mirrors the server-side cap — a poisoned/oversized cache entry must not
// blow up the textarea state.
const MAX_CACHED_VALUE_LENGTH = 300;

export function readCachedSuggestions(
  storage: Pick<Storage, 'getItem'> | null,
  key: string
): SlotSuggestion[] | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (s): s is SlotSuggestion =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as SlotSuggestion).key === 'string' &&
          typeof (s as SlotSuggestion).value === 'string'
      )
      .map((s) => ({
        key: s.key,
        value: s.value.slice(0, MAX_CACHED_VALUE_LENGTH),
        is_example: s.is_example === true,
      }));
  } catch {
    return null;
  }
}

export function writeCachedSuggestions(
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  suggestions: SlotSuggestion[]
): void {
  try {
    storage?.setItem(key, JSON.stringify(suggestions));
  } catch {
    // Private mode / quota — cache is an optimization, never a blocker (D8).
  }
}

// --- Slot answer persistence (T5.5: answers survive a reload) ---

export function slotsStorageKey(templateId: string): string {
  return `prolora:guide-slots:${templateId}`;
}

export function readStoredSlots(
  storage: Pick<Storage, 'getItem'> | null,
  key: string
): Record<string, string> {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeStoredSlots(
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  slots: Record<string, string>
): void {
  try {
    storage?.setItem(key, JSON.stringify(slots));
  } catch {
    // Best effort — losing persistence must never break typing (D8).
  }
}
