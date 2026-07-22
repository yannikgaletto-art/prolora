// Wizard → composer handoff (GOAL-RUN5 G4). sessionStorage with an in-memory
// fallback for Safari private mode (D8) and a 10-minute TTL so a stale payload
// never silently fills the composer (V1: expiry surfaces as a toast, not a
// silent discard). parseAppliedTemplate is pure — the CRITICAL regression test
// (handoff.test.ts) runs it without a DOM.

export interface AppliedMedia {
  type: 'image' | 'video' | 'document';
  /** Storage key or URL — the same value CreatePostRequest.media.url accepts. */
  url: string;
  mime_type?: string;
  alt_text?: string;
  /** Short-lived signed URL, display only — never persisted (Invariante 6). */
  preview_url?: string;
}

export interface AppliedTemplate {
  content: string;
  firstComment?: string;
  /** Connection ids to preselect (recommended ∩ connected ∩ active). */
  connectionIds: string[];
  extras: {
    templateName: string;
    slides?: string[];
    manualSteps?: string[];
  } | null;
  /** Media to re-attach (archive "reuse" flow). */
  media?: AppliedMedia[];
}

interface HandoffPayload extends AppliedTemplate {
  ts: number;
}

export const HANDOFF_KEY = 'prolora:applied-template';
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

// Safari private mode throws on setItem — the same-runtime navigation still
// works through this module-level fallback (client-side router.push keeps
// the JS context alive).
let memoryFallback: HandoffPayload | null = null;

export type HandoffResult =
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'applied'; payload: AppliedTemplate };

// extras is fully validated field-by-field — a poisoned/mutated storage entry
// must degrade to null instead of crashing the composer's extras Card.
function parseExtras(value: unknown): AppliedTemplate['extras'] {
  if (typeof value !== 'object' || value === null) return null;
  const extras = value as { templateName?: unknown; slides?: unknown; manualSteps?: unknown };
  if (typeof extras.templateName !== 'string') return null;
  const stringList = (list: unknown): string[] | undefined =>
    Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : undefined;
  return {
    templateName: extras.templateName,
    slides: stringList(extras.slides),
    manualSteps: stringList(extras.manualSteps),
  };
}

// Same defensive stance as parseExtras: a malformed media entry is dropped,
// never allowed to crash the composer or attach an unusable item.
const MEDIA_TYPES = new Set<AppliedMedia['type']>(['image', 'video', 'document']);

function parseMedia(value: unknown): AppliedMedia[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: AppliedMedia[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const media = entry as {
      type?: unknown;
      url?: unknown;
      mime_type?: unknown;
      alt_text?: unknown;
      preview_url?: unknown;
    };
    if (typeof media.url !== 'string' || media.url.length === 0) continue;
    if (typeof media.type !== 'string' || !MEDIA_TYPES.has(media.type as AppliedMedia['type'])) continue;
    items.push({
      type: media.type as AppliedMedia['type'],
      url: media.url,
      mime_type: typeof media.mime_type === 'string' ? media.mime_type : undefined,
      alt_text: typeof media.alt_text === 'string' ? media.alt_text : undefined,
      preview_url: typeof media.preview_url === 'string' ? media.preview_url : undefined,
    });
  }
  return items.length > 0 ? items : undefined;
}

/** Pure core — feed it raw storage content and a clock. */
export function parseAppliedTemplate(raw: string | null, now: number): HandoffResult {
  if (!raw) return { status: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'none' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'none' };
  const payload = parsed as Partial<HandoffPayload>;
  if (typeof payload.content !== 'string' || typeof payload.ts !== 'number') {
    return { status: 'none' };
  }
  if (now - payload.ts > HANDOFF_TTL_MS) return { status: 'expired' };
  return {
    status: 'applied',
    payload: {
      content: payload.content,
      firstComment: typeof payload.firstComment === 'string' ? payload.firstComment : undefined,
      connectionIds: Array.isArray(payload.connectionIds)
        ? payload.connectionIds.filter((id): id is string => typeof id === 'string')
        : [],
      extras: parseExtras(payload.extras),
      media: parseMedia(payload.media),
    },
  };
}

export function storeAppliedTemplate(payload: AppliedTemplate, now: number): void {
  const withTs: HandoffPayload = { ...payload, ts: now };
  memoryFallback = withTs;
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(withTs));
  } catch {
    // Storage unavailable (private mode/quota) — memoryFallback carries it (D8).
  }
}

/** Read-and-clear. Returns 'expired' so the composer can show the V1 toast. */
export function takeAppliedTemplate(now: number): HandoffResult {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(HANDOFF_KEY);
    window.sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    // Fall through to the memory fallback.
  }
  if (raw === null && memoryFallback !== null) {
    raw = JSON.stringify(memoryFallback);
  }
  memoryFallback = null;
  return parseAppliedTemplate(raw, now);
}
