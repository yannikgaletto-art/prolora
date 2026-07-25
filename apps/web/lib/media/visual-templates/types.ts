// Deterministische Bild-Templates (Plan 2 / 2A.6) — Typen und Formate.
//
// Warum es diese Templates gibt: bei 10 EUR Monatsbudget und 0,12 EUR pro
// generiertem Bild sind 75 Posts mit Auswahl-Verwerfungen nicht finanzierbar
// (Plan 2 §8). Serverseitig gerenderte Templates kosten NULL, sind reproduzierbar
// und markenkonsistenter als jede Generierung. Generiert wird nur noch dort, wo
// es wirklich ein Bild sein muss.
//
// Jedes Template zieht Farben und Typografie aus dem Brand-Visual-Profile
// (lib/media/brand-profile.ts). Es gibt keinen Template-eigenen Farbwert.

export type VisualTemplateId =
  | 'quote_card'
  | 'data_point'
  | 'before_after'
  | 'framework_diagram'
  | 'screenshot_frame';

export const VISUAL_TEMPLATE_IDS: readonly VisualTemplateId[] = [
  'quote_card',
  'data_point',
  'before_after',
  'framework_diagram',
  'screenshot_frame',
];

export type VisualFormat = 'square' | 'portrait' | 'landscape';

export const VISUAL_FORMATS: Record<VisualFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 628 },
};

export interface QuoteCardInput {
  kind: 'quote_card';
  /** Wörtliches Zitat. Kommt idealerweise aus einem proof_asset. */
  quote: string;
  attribution?: string | null;
  context?: string | null;
}

export interface DataPointInput {
  kind: 'data_point';
  /** Die Zahl, groß. Bereits formatiert ("31 %", "2,4×", "1.240"). */
  value: string;
  label: string;
  delta?: string | null;
  caption?: string | null;
}

export interface BeforeAfterInput {
  kind: 'before_after';
  beforeLabel: string;
  beforeValue: string;
  afterLabel: string;
  afterValue: string;
  caption?: string | null;
}

export interface FrameworkDiagramInput {
  kind: 'framework_diagram';
  title: string;
  /** 2–6 Schritte. Mehr passt in kein Social-Format. */
  steps: string[];
  caption?: string | null;
}

export interface ScreenshotFrameInput {
  kind: 'screenshot_frame';
  title: string;
  /** Zeilen im „Fenster" — z. B. ein Log, eine Nachricht, ein Auszug. */
  body: string[];
  sourceLabel?: string | null;
}

export type VisualTemplateInput =
  | QuoteCardInput
  | DataPointInput
  | BeforeAfterInput
  | FrameworkDiagramInput
  | ScreenshotFrameInput;

/**
 * Minimaler React-Element-Ersatz. satori braucht nur `type`/`props`; wir bauen
 * die Bäume als reine Objekte, damit die Layout-Funktionen ohne JSX-Runtime
 * getestet werden können und die Templates keine React-Abhängigkeit bekommen.
 */
export interface VNode {
  type: string;
  props: VNodeProps;
}

export interface VNodeProps {
  style?: Record<string, string | number>;
  children?: VNodeChild | VNodeChild[];
  [key: string]: unknown;
}

export type VNodeChild = VNode | string | number | null | false;

export function el(
  type: string,
  style: Record<string, string | number>,
  children?: VNodeChild | VNodeChild[]
): VNode {
  return { type, props: { style, children: children ?? undefined } };
}
