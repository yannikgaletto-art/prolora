// Renderer der deterministischen Templates (Plan 2 / 2A.6, Entscheidung D2).
//
// Kette: Layout-Baum -> satori (SVG) -> @resvg/resvg-js (PNG). Kein
// Provider-Aufruf, keine Ledger-Reservierung, Kosten = 0. Genau deshalb steht
// dieses Modul zwischen dem Budget-Problem und den 75 Posts im Monat.
//
// Beide Bibliotheken werden LAZY importiert: @resvg/resvg-js ist ein natives
// Modul, und der Rest der App (Publishing, Feedback) darf nicht davon abhängen,
// dass es auf einer Plattform lädt.
import { ApiError } from '@/lib/api/http';
import type { BrandVisualProfile } from '@/lib/media/brand-profile';
import { buildTemplate, type LayoutOptions } from './layout';
import { loadTemplateFont } from './fonts';
import { VISUAL_FORMATS, type VisualFormat, type VisualTemplateInput } from './types';

export interface RenderOptions extends LayoutOptions {
  format?: VisualFormat;
  /** Erlaubt Tests und spätere Workspace-Schriften, den Buffer vorzugeben. */
  fontData?: Buffer | null;
  fontFamily?: string;
}

export interface RenderedVisual {
  svg: string;
  png: Buffer;
  width: number;
  height: number;
  format: VisualFormat;
  /** Immer 0 — das ist der Punkt dieses Moduls. */
  estimatedEur: 0;
}

export async function renderVisualSvg(
  input: VisualTemplateInput,
  profile: BrandVisualProfile,
  options: RenderOptions = {}
): Promise<{ svg: string; width: number; height: number; format: VisualFormat }> {
  const format = options.format ?? 'square';
  const dims = VISUAL_FORMATS[format];

  const fontData = options.fontData ?? (await loadTemplateFont());
  if (!fontData) {
    throw new ApiError(
      503,
      'Keine Schriftdatei für den Template-Renderer gefunden. VISUAL_TEMPLATE_FONT_PATH setzen.',
      'visual_font_missing'
    );
  }

  const node = buildTemplate(input, profile, format, { logoDataUri: options.logoDataUri });
  const { default: satori } = await import('satori');
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], {
    width: dims.width,
    height: dims.height,
    fonts: [
      {
        name: options.fontFamily ?? profile.typography.fontFamily,
        data: fontData,
        weight: 400,
        style: 'normal',
      },
      // Dieselbe Datei als Bold-Eintrag: ohne passenden Schnitt würde satori
      // fette Überschriften still auf 400 zurückfallen lassen.
      {
        name: options.fontFamily ?? profile.typography.fontFamily,
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  return { svg, width: dims.width, height: dims.height, format };
}

export async function renderVisual(
  input: VisualTemplateInput,
  profile: BrandVisualProfile,
  options: RenderOptions = {}
): Promise<RenderedVisual> {
  const { svg, width, height, format } = await renderVisualSvg(input, profile, options);
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    // Systemschriften abschalten: das Ergebnis muss auf jeder Maschine
    // identisch sein, und satori bettet die Glyphen bereits als Pfade ein.
    font: { loadSystemFonts: false },
  });
  const png = Buffer.from(resvg.render().asPng());
  return { svg, png, width, height, format, estimatedEur: 0 };
}
