// Plan 2 / 2A.6 — deterministische Bild-Templates.
//
// Drei Zusagen werden geprüft:
//   1. Kein Template bringt eigene Farben mit — alles kommt aus dem Brand-Profil.
//   2. Das Layout ist deterministisch (zweimal derselbe Baum).
//   3. Die Kette satori -> resvg produziert tatsächlich ein PNG, ohne Netz und
//      ohne Provider-Aufruf (Kosten 0).
import { describe, expect, test } from 'vitest';
import { sanitizeProfile, type BrandVisualProfile } from '@/lib/media/brand-profile';
import { buildTemplate } from '@/lib/media/visual-templates/layout';
import { loadTemplateFont, fontCandidatePaths } from '@/lib/media/visual-templates/fonts';
import { renderVisual, renderVisualSvg } from '@/lib/media/visual-templates/render';
import {
  VISUAL_FORMATS,
  VISUAL_TEMPLATE_IDS,
  type VisualTemplateInput,
  type VNode,
  type VNodeChild,
} from '@/lib/media/visual-templates/types';
import {
  VISUAL_TEMPLATE_CATALOG,
  isVisualTemplateId,
  visualRenderSchema,
} from '@/lib/media/visual-templates';

const profile: BrandVisualProfile = sanitizeProfile({
  color_primary: '#0B1F3A',
  color_secondary: '#3D5A80',
  color_accent: '#EE6C4D',
  color_background: '#FDFDFD',
  color_foreground: '#0B1F3A',
  color_muted: '#98A2B3',
  font_family: 'Noto Sans',
  font_scale: 1,
  heading_weight: 700,
  corner_radius: 16,
  logo_placement: 'bottom_left',
  watermark_text: 'prolora.eu',
});

const SAMPLES: Record<string, VisualTemplateInput> = {
  quote_card: {
    kind: 'quote_card',
    quote: 'Seit dem Umstieg sind unsere Support-Tickets um 31 % gesunken.',
    attribution: 'Lena K., Head of Support',
    context: 'Aus dem Trustpilot-Review vom 14. Juli',
  },
  data_point: { kind: 'data_point', value: '31 %', label: 'weniger Support-Tickets', delta: '−31 %', caption: 'Quelle: Support-Export' },
  before_after: {
    kind: 'before_after',
    beforeLabel: 'Vorher',
    beforeValue: '4,2 h',
    afterLabel: 'Nachher',
    afterValue: '1,1 h',
    caption: 'Durchschnittliche Reaktionszeit',
  },
  framework_diagram: {
    kind: 'framework_diagram',
    title: 'So finden wir Post-Anlässe',
    steps: ['Feedback clustern', 'Momentum messen', 'Beleg zuordnen', 'Gate durchlaufen'],
    caption: 'Vier Schritte, keine Ausnahme',
  },
  screenshot_frame: {
    kind: 'screenshot_frame',
    title: 'support@prolora.eu',
    body: ['> Ticket #4821 geschlossen', '> Bearbeitungszeit: 12 Minuten'],
    sourceLabel: 'Helpdesk-Export',
  },
};

function collect(node: VNodeChild, out: { colors: string[]; texts: string[] }): void {
  if (node === null || node === false) return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.texts.push(String(node));
    return;
  }
  const style = node.props.style ?? {};
  for (const [key, value] of Object.entries(style)) {
    if (typeof value !== 'string') continue;
    if (/color/i.test(key) || key === 'border') {
      for (const match of value.match(/#[0-9A-Fa-f]{6}/g) ?? []) out.colors.push(match.toUpperCase());
    }
  }
  const children = node.props.children;
  if (Array.isArray(children)) children.forEach((child) => collect(child, out));
  else if (children !== undefined) collect(children as VNodeChild, out);
}

describe('Katalog', () => {
  test('deckt alle fünf Template-IDs ab und kostet null', () => {
    expect(VISUAL_TEMPLATE_CATALOG.map((entry) => entry.id).sort()).toEqual([...VISUAL_TEMPLATE_IDS].sort());
    expect(VISUAL_TEMPLATE_CATALOG).toHaveLength(5);
    for (const entry of VISUAL_TEMPLATE_CATALOG) {
      expect(entry.estimatedEur, entry.id).toBe(0);
    }
  });

  test('isVisualTemplateId erkennt nur die fünf', () => {
    expect(isVisualTemplateId('quote_card')).toBe(true);
    expect(isVisualTemplateId('meme')).toBe(false);
  });
});

describe('Validierung', () => {
  test('akzeptiert eine vollständige Anfrage und setzt square als Default', () => {
    const parsed = visualRenderSchema.parse({ template: SAMPLES.data_point });
    expect(parsed.format).toBe('square');
  });

  test('weist leere und überzählige Eingaben ab', () => {
    expect(visualRenderSchema.safeParse({ template: { kind: 'quote_card', quote: '' } }).success).toBe(false);
    expect(
      visualRenderSchema.safeParse({
        template: { kind: 'framework_diagram', title: 'X', steps: ['nur einer'] },
      }).success
    ).toBe(false);
    expect(
      visualRenderSchema.safeParse({
        template: { kind: 'framework_diagram', title: 'X', steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      }).success
    ).toBe(false);
    expect(visualRenderSchema.safeParse({ template: { kind: 'unbekannt' } }).success).toBe(false);
  });
});

describe('buildTemplate', () => {
  test('jedes Template rendert im richtigen Format', () => {
    for (const [id, input] of Object.entries(SAMPLES)) {
      for (const [format, dims] of Object.entries(VISUAL_FORMATS)) {
        const node = buildTemplate(input, profile, format as keyof typeof VISUAL_FORMATS);
        expect(node.props.style?.width, `${id}/${format}`).toBe(dims.width);
        expect(node.props.style?.height, `${id}/${format}`).toBe(dims.height);
      }
    }
  });

  test('verwendet ausschließlich Farben aus dem Brand-Profil', () => {
    const allowed = new Set(Object.values(profile.palette).map((color) => color.toUpperCase()));
    for (const [id, input] of Object.entries(SAMPLES)) {
      const out = { colors: [] as string[], texts: [] as string[] };
      collect(buildTemplate(input, profile), out);
      expect(out.colors.length, id).toBeGreaterThan(0);
      for (const color of out.colors) {
        expect(allowed.has(color), `${id} nutzt Fremdfarbe ${color}`).toBe(true);
      }
    }
  });

  test('trägt Inhalt und Wasserzeichen in den Baum', () => {
    const out = { colors: [] as string[], texts: [] as string[] };
    collect(buildTemplate(SAMPLES.data_point, profile), out);
    expect(out.texts).toContain('31 %');
    expect(out.texts).toContain('weniger Support-Tickets');
    expect(out.texts).toContain('prolora.eu');
  });

  test('kürzt zu lange Eingaben, statt das Layout sprengen zu lassen', () => {
    const out = { colors: [] as string[], texts: [] as string[] };
    collect(
      buildTemplate({ kind: 'quote_card', quote: 'A'.repeat(900) }, profile),
      out
    );
    const quote = out.texts.find((text) => text.startsWith('AAA'));
    expect(quote).toBeDefined();
    expect(quote!.length).toBeLessThanOrEqual(260);
  });

  test('begrenzt Framework-Schritte auf sechs', () => {
    const out = { colors: [] as string[], texts: [] as string[] };
    collect(
      buildTemplate(
        {
          kind: 'framework_diagram',
          title: 'Zu viele Schritte',
          steps: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'],
        },
        profile
      ),
      out
    );
    expect(out.texts).toContain('f6');
    expect(out.texts).not.toContain('g7');
  });

  test('ist deterministisch — zweimal derselbe Baum', () => {
    expect(buildTemplate(SAMPLES.before_after, profile)).toEqual(
      buildTemplate(SAMPLES.before_after, profile)
    );
  });

  test('logo_placement=none blendet das Wasserzeichen aus', () => {
    const out = { colors: [] as string[], texts: [] as string[] };
    collect(buildTemplate(SAMPLES.data_point, sanitizeProfile({ ...{}, logo_placement: 'none', watermark_text: 'prolora.eu' }) as BrandVisualProfile, 'square'), out);
    expect(out.texts).not.toContain('prolora.eu');
  });
});

describe('Renderer (satori -> resvg)', () => {
  test('findet eine Schrift ohne Netzwerkzugriff', async () => {
    expect(fontCandidatePaths().length).toBeGreaterThan(0);
    const font = await loadTemplateFont();
    expect(font, `keine Schrift gefunden in: ${fontCandidatePaths().join(', ')}`).not.toBeNull();
    expect(font!.byteLength).toBeGreaterThan(1000);
  });

  test('erzeugt gültiges SVG in den Zielmaßen', async () => {
    const result = await renderVisualSvg(SAMPLES.quote_card, profile, { format: 'landscape' });
    expect(result.svg.startsWith('<svg')).toBe(true);
    expect(result.svg).toContain(`width="${VISUAL_FORMATS.landscape.width}"`);
    expect(result.width).toBe(VISUAL_FORMATS.landscape.width);
    expect(result.height).toBe(VISUAL_FORMATS.landscape.height);
  });

  test('erzeugt ein PNG und meldet Kosten 0', async () => {
    const result = await renderVisual(SAMPLES.data_point, profile, { format: 'square' });
    expect(result.estimatedEur).toBe(0);
    expect(result.png.byteLength).toBeGreaterThan(1000);
    // PNG-Magie: 89 50 4E 47
    expect([...result.png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('dasselbe Template ergibt byte-identisches SVG', async () => {
    const first = await renderVisualSvg(SAMPLES.framework_diagram, profile);
    const second = await renderVisualSvg(SAMPLES.framework_diagram, profile);
    expect(second.svg).toBe(first.svg);
  });
}, 30_000);
