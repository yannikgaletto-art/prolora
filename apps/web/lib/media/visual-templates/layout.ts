// Layout der fünf deterministischen Templates (Plan 2 / 2A.6).
//
// Reine Funktionen: Eingabe + Brand-Profil -> VNode-Baum. Kein I/O, kein
// Zufall, keine Uhrzeit. Damit ist dasselbe Bild jederzeit reproduzierbar und
// das Layout ohne Renderer testbar.
//
// satori-Eigenheit, die das Layout prägt: jedes Element mit mehr als einem Kind
// braucht ein explizites `display: flex`. Deshalb steht es hier überall.
import type { BrandVisualProfile } from '@/lib/media/brand-profile';
import {
  el,
  VISUAL_FORMATS,
  type VisualFormat,
  type VisualTemplateInput,
  type VNode,
  type VNodeChild,
} from './types';

export interface LayoutOptions {
  /** Logo als data:-URI. Der Storage-Key allein reicht satori nicht (Invariante 6). */
  logoDataUri?: string | null;
}

const MAX_STEPS = 6;
const MAX_BODY_LINES = 8;

export function buildTemplate(
  input: VisualTemplateInput,
  profile: BrandVisualProfile,
  format: VisualFormat = 'square',
  options: LayoutOptions = {}
): VNode {
  const dims = VISUAL_FORMATS[format];
  const scale = (dims.width / 1080) * profile.typography.fontScale;
  const pad = Math.round(72 * (dims.width / 1080));

  const body = ((): VNode => {
    switch (input.kind) {
      case 'quote_card':
        return quoteCard(input, profile, scale);
      case 'data_point':
        return dataPoint(input, profile, scale);
      case 'before_after':
        return beforeAfter(input, profile, scale);
      case 'framework_diagram':
        return frameworkDiagram(input, profile, scale);
      case 'screenshot_frame':
        return screenshotFrame(input, profile, scale);
    }
  })();

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: dims.width,
      height: dims.height,
      padding: pad,
      backgroundColor: profile.palette.background,
      color: profile.palette.foreground,
      fontFamily: profile.typography.fontFamily,
    },
    [accentBar(profile, scale), body, footer(profile, scale, options)]
  );
}

// ---------------------------------------------------------------------------
// Rahmen
// ---------------------------------------------------------------------------

function accentBar(profile: BrandVisualProfile, scale: number): VNode {
  return el('div', {
    display: 'flex',
    width: Math.round(96 * scale),
    height: Math.round(8 * scale),
    borderRadius: 999,
    backgroundColor: profile.palette.accent,
  });
}

function footer(profile: BrandVisualProfile, scale: number, options: LayoutOptions): VNode {
  const children: VNodeChild[] = [];
  const showLeft = profile.logo.placement === 'bottom_left' || profile.logo.placement === 'top_left';

  const mark: VNodeChild = options.logoDataUri
    ? { type: 'img', props: { src: options.logoDataUri, width: Math.round(120 * scale), height: Math.round(32 * scale), style: { objectFit: 'contain' } } }
    : profile.watermarkText
      ? el(
          'div',
          {
            display: 'flex',
            fontSize: Math.round(22 * scale),
            color: profile.palette.muted,
            letterSpacing: 1,
          },
          profile.watermarkText
        )
      : null;

  const spacer = el('div', { display: 'flex' });
  if (profile.logo.placement === 'none' || !mark) {
    children.push(spacer);
  } else if (showLeft) {
    children.push(mark, spacer);
  } else {
    children.push(spacer, mark);
  }

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    children
  );
}

// ---------------------------------------------------------------------------
// 1. Zitat-Karte
// ---------------------------------------------------------------------------

function quoteCard(
  input: Extract<VisualTemplateInput, { kind: 'quote_card' }>,
  profile: BrandVisualProfile,
  scale: number
): VNode {
  const quote = clip(input.quote, 260);
  const size = quote.length > 160 ? 46 : quote.length > 90 ? 56 : 68;
  const children: VNodeChild[] = [
    el(
      'div',
      {
        display: 'flex',
        fontSize: Math.round(96 * scale),
        lineHeight: 0.8,
        color: profile.palette.accent,
        fontWeight: profile.typography.headingWeight,
      },
      '„'
    ),
    el(
      'div',
      {
        display: 'flex',
        fontSize: Math.round(size * scale),
        lineHeight: 1.3,
        fontWeight: profile.typography.headingWeight,
        color: profile.palette.foreground,
      },
      quote
    ),
  ];
  if (input.attribution?.trim()) {
    children.push(
      el(
        'div',
        {
          display: 'flex',
          marginTop: Math.round(28 * scale),
          fontSize: Math.round(28 * scale),
          color: profile.palette.secondary,
        },
        `— ${clip(input.attribution.trim(), 60)}`
      )
    );
  }
  if (input.context?.trim()) {
    children.push(caption(clip(input.context.trim(), 120), profile, scale));
  }
  return column(children, scale);
}

// ---------------------------------------------------------------------------
// 2. Datenpunkt-Karte
// ---------------------------------------------------------------------------

function dataPoint(
  input: Extract<VisualTemplateInput, { kind: 'data_point' }>,
  profile: BrandVisualProfile,
  scale: number
): VNode {
  const value = clip(input.value, 12);
  const size = value.length > 8 ? 150 : value.length > 5 ? 190 : 230;
  const children: VNodeChild[] = [
    el(
      'div',
      {
        display: 'flex',
        fontSize: Math.round(size * scale),
        lineHeight: 1,
        fontWeight: profile.typography.headingWeight,
        color: profile.palette.accent,
      },
      value
    ),
    el(
      'div',
      {
        display: 'flex',
        marginTop: Math.round(24 * scale),
        fontSize: Math.round(44 * scale),
        lineHeight: 1.25,
        color: profile.palette.foreground,
      },
      clip(input.label, 90)
    ),
  ];
  if (input.delta?.trim()) {
    children.push(
      el(
        'div',
        {
          display: 'flex',
          marginTop: Math.round(16 * scale),
          paddingTop: Math.round(8 * scale),
          paddingBottom: Math.round(8 * scale),
          paddingLeft: Math.round(20 * scale),
          paddingRight: Math.round(20 * scale),
          borderRadius: profile.cornerRadius,
          backgroundColor: profile.palette.accent,
          color: profile.palette.background,
          fontSize: Math.round(26 * scale),
        },
        clip(input.delta.trim(), 30)
      )
    );
  }
  if (input.caption?.trim()) {
    children.push(caption(clip(input.caption.trim(), 140), profile, scale));
  }
  return column(children, scale);
}

// ---------------------------------------------------------------------------
// 3. Vorher-Nachher
// ---------------------------------------------------------------------------

function beforeAfter(
  input: Extract<VisualTemplateInput, { kind: 'before_after' }>,
  profile: BrandVisualProfile,
  scale: number
): VNode {
  const panel = (label: string, value: string, accent: boolean): VNode =>
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        padding: Math.round(36 * scale),
        borderRadius: profile.cornerRadius,
        backgroundColor: accent ? profile.palette.accent : profile.palette.muted,
        color: profile.palette.background,
      },
      [
        el('div', { display: 'flex', fontSize: Math.round(26 * scale), opacity: 0.85 }, clip(label, 30)),
        el(
          'div',
          {
            display: 'flex',
            marginTop: Math.round(12 * scale),
            fontSize: Math.round(72 * scale),
            lineHeight: 1.05,
            fontWeight: profile.typography.headingWeight,
          },
          clip(value, 12)
        ),
      ]
    );

  const children: VNodeChild[] = [
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        gap: Math.round(24 * scale),
      },
      [
        panel(input.beforeLabel, input.beforeValue, false),
        el(
          'div',
          {
            display: 'flex',
            fontSize: Math.round(56 * scale),
            color: profile.palette.secondary,
            fontWeight: profile.typography.headingWeight,
          },
          '→'
        ),
        panel(input.afterLabel, input.afterValue, true),
      ]
    ),
  ];
  if (input.caption?.trim()) {
    children.push(caption(clip(input.caption.trim(), 160), profile, scale));
  }
  return column(children, scale);
}

// ---------------------------------------------------------------------------
// 4. Framework-Diagramm
// ---------------------------------------------------------------------------

function frameworkDiagram(
  input: Extract<VisualTemplateInput, { kind: 'framework_diagram' }>,
  profile: BrandVisualProfile,
  scale: number
): VNode {
  const steps = input.steps
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .slice(0, MAX_STEPS);

  const children: VNodeChild[] = [
    el(
      'div',
      {
        display: 'flex',
        fontSize: Math.round(56 * scale),
        lineHeight: 1.2,
        fontWeight: profile.typography.headingWeight,
      },
      clip(input.title, 70)
    ),
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        marginTop: Math.round(32 * scale),
        gap: Math.round(14 * scale),
        width: '100%',
      },
      steps.map((step, index) =>
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: Math.round(18 * scale),
            padding: Math.round(20 * scale),
            borderRadius: profile.cornerRadius,
            border: `${Math.max(2, Math.round(2 * scale))}px solid ${profile.palette.muted}`,
          },
          [
            el(
              'div',
              {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: Math.round(48 * scale),
                height: Math.round(48 * scale),
                borderRadius: 999,
                backgroundColor: profile.palette.accent,
                color: profile.palette.background,
                fontSize: Math.round(26 * scale),
                fontWeight: profile.typography.headingWeight,
              },
              String(index + 1)
            ),
            el(
              'div',
              { display: 'flex', fontSize: Math.round(32 * scale), color: profile.palette.foreground },
              clip(step, 70)
            ),
          ]
        )
      )
    ),
  ];
  if (input.caption?.trim()) {
    children.push(caption(clip(input.caption.trim(), 140), profile, scale));
  }
  return column(children, scale);
}

// ---------------------------------------------------------------------------
// 5. Screenshot-Rahmen
// ---------------------------------------------------------------------------

function screenshotFrame(
  input: Extract<VisualTemplateInput, { kind: 'screenshot_frame' }>,
  profile: BrandVisualProfile,
  scale: number
): VNode {
  const lines = input.body
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_BODY_LINES);

  const dot = (color: string): VNode =>
    el('div', {
      display: 'flex',
      width: Math.round(16 * scale),
      height: Math.round(16 * scale),
      borderRadius: 999,
      backgroundColor: color,
    });

  const children: VNodeChild[] = [
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderRadius: profile.cornerRadius,
        overflow: 'hidden',
        border: `${Math.max(2, Math.round(2 * scale))}px solid ${profile.palette.muted}`,
      },
      [
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: Math.round(10 * scale),
            padding: Math.round(18 * scale),
            backgroundColor: profile.palette.muted,
          },
          [
            dot(profile.palette.background),
            dot(profile.palette.background),
            dot(profile.palette.background),
            el(
              'div',
              {
                display: 'flex',
                marginLeft: Math.round(16 * scale),
                fontSize: Math.round(24 * scale),
                color: profile.palette.background,
              },
              clip(input.title, 48)
            ),
          ]
        ),
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            gap: Math.round(12 * scale),
            padding: Math.round(32 * scale),
            backgroundColor: profile.palette.background,
          },
          lines.map((line) =>
            el(
              'div',
              {
                display: 'flex',
                fontSize: Math.round(30 * scale),
                lineHeight: 1.35,
                color: profile.palette.foreground,
              },
              clip(line, 80)
            )
          )
        ),
      ]
    ),
  ];
  if (input.sourceLabel?.trim()) {
    children.push(caption(`Quelle: ${clip(input.sourceLabel.trim(), 80)}`, profile, scale));
  }
  return column(children, scale);
}

// ---------------------------------------------------------------------------

function column(children: VNodeChild[], scale: number): VNode {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      flexGrow: 1,
      paddingTop: Math.round(32 * scale),
      paddingBottom: Math.round(32 * scale),
      width: '100%',
    },
    children
  );
}

function caption(text: string, profile: BrandVisualProfile, scale: number): VNode {
  return el(
    'div',
    {
      display: 'flex',
      marginTop: Math.round(28 * scale),
      fontSize: Math.round(24 * scale),
      color: profile.palette.muted,
      lineHeight: 1.4,
    },
    text
  );
}

/** Harte Kürzung — ein Template, das überläuft, ist schlimmer als eines, das kürzt. */
export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
