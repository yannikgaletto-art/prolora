// Brand-Visual-Profile (Plan 2 / 2A.5, Migration 018).
//
// Ein Workspace-Asset: Palette, Typografie, Bildsprache, Logo-Platzierung.
// Es fließt in JEDEN Bild-Prompt (brandPromptFragment) und in jedes
// deterministische Template (lib/media/visual-templates/**). Ohne diese eine
// Quelle erzeugen 75 Posts im Monat visuellen Wildwuchs, und die Marke
// verschwindet zwischen den eigenen Beiträgen.
//
// Fehlt die Zeile oder die ganze Tabelle (Migration 018 noch nicht angewendet),
// greifen DEFAULT_BRAND_PROFILE — die Templates rendern also auch ohne Setup.
//
// Row-Type steht LOKAL statt in lib/db.ts: Plan 2 lässt zwei Agenten parallel
// arbeiten, und lib/db.ts gehört in diesem Lauf dem anderen Strang.
import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

export type LogoPlacement = 'none' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
export type HeadingWeight = 400 | 500 | 600 | 700 | 800 | 900;

export interface BrandVisualProfileRow {
  id: string;
  workspace_id: string;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  color_background: string;
  color_foreground: string;
  color_muted: string;
  font_family: string;
  font_scale: number;
  heading_weight: HeadingWeight;
  corner_radius: number;
  imagery_style: string | null;
  imagery_avoid: string[];
  logo_storage_key: string | null;
  logo_placement: LogoPlacement;
  watermark_text: string | null;
  created_at: string;
  updated_at: string;
}

export const BRAND_PROFILE_COLUMNS = [
  'id', 'workspace_id', 'color_primary', 'color_secondary', 'color_accent',
  'color_background', 'color_foreground', 'color_muted', 'font_family', 'font_scale',
  'heading_weight', 'corner_radius', 'imagery_style', 'imagery_avoid',
  'logo_storage_key', 'logo_placement', 'watermark_text', 'created_at', 'updated_at',
].join(', ');

export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  foreground: string;
  muted: string;
}

export interface BrandVisualProfile {
  palette: BrandPalette;
  typography: {
    fontFamily: string;
    /** Multiplikator auf alle Schriftgrößen der Templates. */
    fontScale: number;
    headingWeight: HeadingWeight;
  };
  cornerRadius: number;
  imagery: {
    style: string | null;
    avoid: string[];
  };
  logo: {
    /** Storage-Key, nie eine ablaufende URL (Invariante 6 / R2). */
    storageKey: string | null;
    placement: LogoPlacement;
  };
  watermarkText: string | null;
  /** false = es gibt noch keine gespeicherte Zeile, die Defaults greifen. */
  configured: boolean;
}

export const DEFAULT_BRAND_PROFILE: BrandVisualProfile = {
  palette: {
    primary: '#111827',
    secondary: '#4B5563',
    accent: '#2563EB',
    background: '#FFFFFF',
    foreground: '#111827',
    muted: '#6B7280',
  },
  typography: { fontFamily: 'Noto Sans', fontScale: 1, headingWeight: 700 },
  cornerRadius: 24,
  imagery: { style: null, avoid: [] },
  logo: { storageKey: null, placement: 'bottom_left' },
  watermarkText: null,
  configured: false,
};

const MIGRATION_PENDING = new ApiError(
  503,
  'Das Brand-Visual-Profil ist noch nicht eingerichtet — supabase/migrations/018_brand_visual_profile.sql anwenden.',
  'migration_pending'
);

const HEX = /^#[0-9A-Fa-f]{6}$/;
const HEADING_WEIGHTS: readonly number[] = [400, 500, 600, 700, 800, 900];

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/**
 * Jeder Wert, der in den SVG-Renderer geht, wird hier gegen die Defaults
 * gefiltert. satori bekommt Farben roh — ein ungeprüfter String wäre eine
 * Injektionsfläche im generierten SVG.
 */
export function sanitizeProfile(input: Partial<BrandVisualProfileRow> | null): BrandVisualProfile {
  if (!input) return DEFAULT_BRAND_PROFILE;
  const fallback = DEFAULT_BRAND_PROFILE;
  const color = (value: unknown, backup: string): string => (isHexColor(value) ? value : backup);
  const scale = Number(input.font_scale);
  const radius = Number(input.corner_radius);
  const weight = Number(input.heading_weight);

  return {
    palette: {
      primary: color(input.color_primary, fallback.palette.primary),
      secondary: color(input.color_secondary, fallback.palette.secondary),
      accent: color(input.color_accent, fallback.palette.accent),
      background: color(input.color_background, fallback.palette.background),
      foreground: color(input.color_foreground, fallback.palette.foreground),
      muted: color(input.color_muted, fallback.palette.muted),
    },
    typography: {
      fontFamily:
        typeof input.font_family === 'string' && input.font_family.trim().length > 0
          ? input.font_family.trim().slice(0, 60)
          : fallback.typography.fontFamily,
      fontScale: Number.isFinite(scale) && scale >= 0.6 && scale <= 2 ? scale : 1,
      headingWeight: (HEADING_WEIGHTS.includes(weight) ? weight : 700) as HeadingWeight,
    },
    cornerRadius: Number.isFinite(radius) && radius >= 0 && radius <= 96 ? Math.round(radius) : 24,
    imagery: {
      style: typeof input.imagery_style === 'string' && input.imagery_style.trim() ? input.imagery_style.trim() : null,
      avoid: Array.isArray(input.imagery_avoid)
        ? input.imagery_avoid.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [],
    },
    logo: {
      storageKey:
        typeof input.logo_storage_key === 'string' && input.logo_storage_key.trim()
          ? input.logo_storage_key.trim()
          : null,
      placement: isPlacement(input.logo_placement) ? input.logo_placement : 'bottom_left',
    },
    watermarkText:
      typeof input.watermark_text === 'string' && input.watermark_text.trim()
        ? input.watermark_text.trim().slice(0, 60)
        : null,
    configured: true,
  };
}

export async function getBrandProfile(workspaceId: string): Promise<BrandVisualProfile> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('brand_visual_profiles')
    .select(BRAND_PROFILE_COLUMNS)
    .eq('workspace_id', workspaceId) // Invariante 2
    .maybeSingle<BrandVisualProfileRow>();
  if (error) {
    // Lesepfad degradiert: ohne Migration 018 wird mit den Defaults gerendert,
    // statt eine Seite oder einen Renderjob zu killen.
    if (isMissingSchemaError(error.code)) {
      console.error('[brand-profile] brand_visual_profiles fehlt — Migration 018 anwenden:', error.message);
      return DEFAULT_BRAND_PROFILE;
    }
    throw new Error(`[brand-profile] load failed: ${error.message}`);
  }
  return data ? sanitizeProfile(data) : DEFAULT_BRAND_PROFILE;
}

export interface BrandProfilePatch {
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
  color_background?: string;
  color_foreground?: string;
  color_muted?: string;
  font_family?: string;
  font_scale?: number;
  heading_weight?: HeadingWeight;
  corner_radius?: number;
  imagery_style?: string | null;
  imagery_avoid?: string[];
  logo_storage_key?: string | null;
  logo_placement?: LogoPlacement;
  watermark_text?: string | null;
}

export async function upsertBrandProfile(
  workspaceId: string,
  patch: BrandProfilePatch
): Promise<BrandVisualProfile> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('brand_visual_profiles')
    .upsert(
      { workspace_id: workspaceId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id' }
    )
    .select(BRAND_PROFILE_COLUMNS)
    .single<BrandVisualProfileRow>();
  if (error || !data) {
    if (isMissingSchemaError(error?.code)) throw MIGRATION_PENDING;
    throw new Error(`[brand-profile] upsert failed: ${error?.message ?? 'no row'}`);
  }
  return sanitizeProfile(data);
}

/**
 * Der Textbaustein, der an JEDEN generierten Bild-Prompt gehängt wird.
 * Bewusst kurz und konkret — ein Absatz Markenprosa verwässert den Prompt mehr,
 * als er ihn steuert.
 */
export function brandPromptFragment(profile: BrandVisualProfile): string {
  const parts = [
    `Farbwelt: Primär ${profile.palette.primary}, Akzent ${profile.palette.accent}, Hintergrund ${profile.palette.background}.`,
  ];
  if (profile.imagery.style) parts.push(`Bildsprache: ${profile.imagery.style}.`);
  if (profile.imagery.avoid.length > 0) {
    parts.push(`Vermeiden: ${profile.imagery.avoid.slice(0, 6).join(', ')}.`);
  }
  parts.push('Kein Text im Bild, keine Logos, keine Wasserzeichen.');
  return parts.join(' ');
}

/**
 * Hängt den Marken-Baustein an einen Nutzer-Prompt. Idempotent: ein bereits
 * gebrandeter Prompt wird nicht ein zweites Mal ergänzt (der Worker liest den
 * gespeicherten Prompt erneut).
 */
export function applyBrandToPrompt(prompt: string, profile: BrandVisualProfile): string {
  const fragment = brandPromptFragment(profile);
  const base = prompt.trim();
  if (base.includes(fragment)) return base;
  return `${base}\n\n${fragment}`;
}

function isPlacement(value: unknown): value is LogoPlacement {
  return (
    value === 'none' ||
    value === 'top_left' ||
    value === 'top_right' ||
    value === 'bottom_left' ||
    value === 'bottom_right'
  );
}
