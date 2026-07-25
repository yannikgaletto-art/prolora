// Plan 2 / 2A.5 — Brand-Visual-Profile.
//
// sanitizeProfile ist die Sicherheitsgrenze vor dem SVG-Renderer: satori
// bekommt Farbwerte roh. Alles, was nicht wie eine Hex-Farbe aussieht, muss
// hier zum Default werden.
import { describe, expect, test } from 'vitest';
import {
  brandPromptFragment,
  isHexColor,
  sanitizeProfile,
  DEFAULT_BRAND_PROFILE,
} from '@/lib/media/brand-profile';

describe('isHexColor', () => {
  test('akzeptiert nur 6-stellige Hex-Werte mit #', () => {
    expect(isHexColor('#1A2B3C')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe('sanitizeProfile', () => {
  test('ohne Zeile gelten die Defaults und configured=false', () => {
    expect(sanitizeProfile(null)).toEqual(DEFAULT_BRAND_PROFILE);
    expect(sanitizeProfile(null).configured).toBe(false);
  });

  test('übernimmt gültige Werte', () => {
    const profile = sanitizeProfile({
      color_primary: '#101010',
      color_accent: '#00AAFF',
      font_family: 'Inter',
      font_scale: 1.25,
      heading_weight: 800,
      corner_radius: 8,
      imagery_style: 'dokumentarisch, natürliches Licht',
      imagery_avoid: ['Stockfotos', ''],
      logo_placement: 'top_right',
      watermark_text: 'prolora.eu',
    });
    expect(profile.palette.primary).toBe('#101010');
    expect(profile.palette.accent).toBe('#00AAFF');
    expect(profile.typography).toEqual({ fontFamily: 'Inter', fontScale: 1.25, headingWeight: 800 });
    expect(profile.cornerRadius).toBe(8);
    expect(profile.imagery.avoid).toEqual(['Stockfotos']);
    expect(profile.logo.placement).toBe('top_right');
    expect(profile.configured).toBe(true);
  });

  test('wirft ungültige Farben und Werte auf die Defaults zurück', () => {
    const profile = sanitizeProfile({
      color_primary: 'javascript:alert(1)',
      color_accent: '#GGGGGG',
      font_scale: 99,
      heading_weight: 123 as never,
      corner_radius: -40,
      logo_placement: 'mitte' as never,
    });
    expect(profile.palette.primary).toBe(DEFAULT_BRAND_PROFILE.palette.primary);
    expect(profile.palette.accent).toBe(DEFAULT_BRAND_PROFILE.palette.accent);
    expect(profile.typography.fontScale).toBe(1);
    expect(profile.typography.headingWeight).toBe(700);
    expect(profile.cornerRadius).toBe(24);
    expect(profile.logo.placement).toBe('bottom_left');
  });

  test('leere Strings werden zu null, nicht zu ""', () => {
    const profile = sanitizeProfile({ imagery_style: '   ', watermark_text: '', logo_storage_key: '  ' });
    expect(profile.imagery.style).toBeNull();
    expect(profile.watermarkText).toBeNull();
    expect(profile.logo.storageKey).toBeNull();
  });
});

describe('brandPromptFragment', () => {
  test('nennt Farben und verbietet Text im Bild', () => {
    const fragment = brandPromptFragment(DEFAULT_BRAND_PROFILE);
    expect(fragment).toContain(DEFAULT_BRAND_PROFILE.palette.accent);
    expect(fragment).toContain('Kein Text im Bild');
  });

  test('nimmt Bildsprache und Negativliste auf', () => {
    const profile = sanitizeProfile({
      imagery_style: 'dokumentarisch',
      imagery_avoid: ['Stockfotos', 'Handshakes'],
    });
    const fragment = brandPromptFragment(profile);
    expect(fragment).toContain('dokumentarisch');
    expect(fragment).toContain('Stockfotos, Handshakes');
  });
});

describe('applyBrandToPrompt', () => {
  test('hängt den Marken-Baustein an', async () => {
    const { applyBrandToPrompt } = await import('@/lib/media/brand-profile');
    const result = applyBrandToPrompt('Ein Schreibtisch bei Morgenlicht', DEFAULT_BRAND_PROFILE);
    expect(result).toContain('Ein Schreibtisch bei Morgenlicht');
    expect(result).toContain(brandPromptFragment(DEFAULT_BRAND_PROFILE));
  });

  test('ist idempotent — der Worker liest den Prompt erneut', async () => {
    const { applyBrandToPrompt } = await import('@/lib/media/brand-profile');
    const once = applyBrandToPrompt('Ein Schreibtisch', DEFAULT_BRAND_PROFILE);
    expect(applyBrandToPrompt(once, DEFAULT_BRAND_PROFILE)).toBe(once);
  });
});
