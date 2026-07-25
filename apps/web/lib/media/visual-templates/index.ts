// Öffentliche Fläche der deterministischen Bild-Templates (Plan 2 / 2A.6).
//
// Katalog + Validierung + "rendern und ablegen". Die Kosten stehen im Katalog
// explizit auf 0 — das ist die Aussage, die dieses Modul gegenüber
// lib/media/generation.ts macht.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getServiceDb } from '@/lib/db';
import { getBrandProfile, type BrandVisualProfile } from '@/lib/media/brand-profile';
import { MEDIA_BUCKET, ensureMediaBucket } from '@/lib/media/transform';
import { renderVisual, type RenderOptions } from './render';
import {
  VISUAL_FORMATS,
  VISUAL_TEMPLATE_IDS,
  type VisualFormat,
  type VisualTemplateId,
  type VisualTemplateInput,
} from './types';

export * from './types';
export { buildTemplate, clip, type LayoutOptions } from './layout';
export { renderVisual, renderVisualSvg, type RenderedVisual, type RenderOptions } from './render';
export { loadTemplateFont, setTemplateFont, fontCandidatePaths } from './fonts';

export interface VisualTemplateMeta {
  id: VisualTemplateId;
  label: string;
  description: string;
  /** Immer 0 — deterministisch gerendert, kein Provider-Aufruf. */
  estimatedEur: 0;
  fields: string[];
}

export const VISUAL_TEMPLATE_CATALOG: VisualTemplateMeta[] = [
  {
    id: 'quote_card',
    label: 'Zitat-Karte',
    description: 'Ein wörtliches Zitat mit Quelle. Braucht einen freigegebenen Beleg.',
    estimatedEur: 0,
    fields: ['quote', 'attribution', 'context'],
  },
  {
    id: 'data_point',
    label: 'Datenpunkt-Karte',
    description: 'Eine Zahl groß, die Einordnung klein. Für belegte Messwerte.',
    estimatedEur: 0,
    fields: ['value', 'label', 'delta', 'caption'],
  },
  {
    id: 'before_after',
    label: 'Vorher-Nachher',
    description: 'Zwei Zustände nebeneinander mit Pfeil. Für Veränderung mit Zahl.',
    estimatedEur: 0,
    fields: ['beforeLabel', 'beforeValue', 'afterLabel', 'afterValue', 'caption'],
  },
  {
    id: 'framework_diagram',
    label: 'Framework-Diagramm',
    description: 'Nummerierte Schritte eines Vorgehens, 2 bis 6 Stück.',
    estimatedEur: 0,
    fields: ['title', 'steps', 'caption'],
  },
  {
    id: 'screenshot_frame',
    label: 'Screenshot-Rahmen',
    description: 'Textzeilen in einem Fensterrahmen — Log, Nachricht, Auszug.',
    estimatedEur: 0,
    fields: ['title', 'body', 'sourceLabel'],
  },
];

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const visualTemplateInputSchema: z.ZodType<VisualTemplateInput> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote_card'),
    quote: text(600),
    attribution: optionalText(120),
    context: optionalText(240),
  }),
  z.object({
    kind: z.literal('data_point'),
    value: text(24),
    label: text(160),
    delta: optionalText(48),
    caption: optionalText(240),
  }),
  z.object({
    kind: z.literal('before_after'),
    beforeLabel: text(48),
    beforeValue: text(24),
    afterLabel: text(48),
    afterValue: text(24),
    caption: optionalText(240),
  }),
  z.object({
    kind: z.literal('framework_diagram'),
    title: text(120),
    steps: z.array(text(120)).min(2).max(6),
    caption: optionalText(240),
  }),
  z.object({
    kind: z.literal('screenshot_frame'),
    title: text(80),
    body: z.array(text(140)).min(1).max(8),
    sourceLabel: optionalText(120),
  }),
]);

export const visualRenderSchema = z.object({
  template: visualTemplateInputSchema,
  format: z.enum(['square', 'portrait', 'landscape']).default('square'),
});

export function isVisualTemplateId(value: unknown): value is VisualTemplateId {
  return typeof value === 'string' && (VISUAL_TEMPLATE_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Rendern + ablegen
// ---------------------------------------------------------------------------

export interface StoredVisual {
  storageKey: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  format: VisualFormat;
  bytes: number;
  estimatedEur: 0;
}

/**
 * Rendert und legt das Ergebnis im privaten Media-Bucket ab. Zurück kommt der
 * Storage-Key, nie eine URL (Invariante 6 / R2) — dieselbe Schlüsselform wie
 * Uploads und Generierungen, damit die Medien-Bibliothek nichts Neues lernen muss.
 */
export async function renderAndStoreVisual(
  workspaceId: string,
  input: VisualTemplateInput,
  options: { format?: VisualFormat; profile?: BrandVisualProfile } & RenderOptions = {}
): Promise<StoredVisual> {
  const profile = options.profile ?? (await getBrandProfile(workspaceId));
  const rendered = await renderVisual(input, profile, {
    ...options,
    format: options.format ?? 'square',
  });

  await ensureMediaBucket();
  const db = getServiceDb();
  const key = `workspaces/${workspaceId}/media/${randomUUID()}/original.png`;
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(key, rendered.png, {
    contentType: 'image/png',
    upsert: false,
  });
  if (error) {
    throw new Error(`[visual-templates] storage upload failed: ${error.message}`);
  }

  return {
    storageKey: key,
    mimeType: 'image/png',
    width: rendered.width,
    height: rendered.height,
    format: rendered.format,
    bytes: rendered.png.byteLength,
    estimatedEur: 0,
  };
}

export { VISUAL_FORMATS };
