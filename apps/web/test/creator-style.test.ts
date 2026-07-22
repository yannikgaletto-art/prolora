import { describe, expect, test } from 'vitest';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { filterTemplates } from '@/lib/templates/filter';
import {
  buildTemplatePrompt,
  resolveTemplateStyle,
  STYLE_PRESET_RULES,
} from '@/lib/templates/render-prompt';
import { buildImpactSystemPrompt } from '@/lib/scoring/score-service';
import { creatorStyleSchema } from '@prolora/shared';
import type { DeterministicResult } from '@/lib/scoring/deterministic';
import type { TemplatePromptInput } from '@/lib/templates/render-prompt';

const neutralTemplate = TEMPLATE_CATALOG.find((template) => template.style_preset === 'neutral')!;

describe('creator style preference', () => {
  test('uses the workspace preference only for neutral templates', () => {
    expect(resolveTemplateStyle('neutral', 'koe_pia')).toBe('koe_pia');
    expect(resolveTemplateStyle('hormozi_carousel', 'koe_pia')).toBe('hormozi_carousel');
    expect(resolveTemplateStyle('neutral', 'neutral')).toBe('neutral');
  });

  test('injects PIA rules into a neutral template draft prompt', () => {
    const prompt = buildTemplatePrompt({
      template: neutralTemplate,
      slots: {},
      targetPlatforms: ['linkedin'],
      context: {
        id: 'context',
        workspace_id: 'workspace',
        website_url: null,
        product_description: null,
        target_audience: null,
        suggested_keywords: [],
        voice_tone: 'casual',
        voice_language: 'de',
        creator_style: 'koe_pia',
        confidence: null,
        core_value: [],
        founder_perspective: null,
        brand_voice: [],
        taboo_topics: [],
        last_updated_at: '2026-07-18T00:00:00Z',
        created_at: '2026-07-18T00:00:00Z',
      },
    });

    expect(prompt.system).toContain(STYLE_PRESET_RULES.koe_pia);
    expect(prompt.system).toContain('Pain');
    expect(prompt.system).toContain('Insight');
    expect(prompt.system).toContain('Action');
  });

  test('keeps neutral prompt behavior unchanged', () => {
    const common: Omit<TemplatePromptInput, 'context'> = {
      template: neutralTemplate,
      slots: {},
      targetPlatforms: ['linkedin'],
    };
    expect(buildTemplatePrompt({ ...common, context: null }).system).toBe(
      buildTemplatePrompt({
        ...common,
        context: {
          id: 'context', workspace_id: 'workspace', website_url: null,
          product_description: null, target_audience: null, suggested_keywords: [],
          voice_tone: 'casual', voice_language: 'de', creator_style: 'neutral',
          confidence: null,
          core_value: [],
          founder_perspective: null,
          brand_voice: [],
          taboo_topics: [], last_updated_at: '', created_at: '',
        },
      }).system
    );
  });

  test('sorts matching templates first without hiding other matches', () => {
    const catalog = [
      { ...neutralTemplate, id: 'neutral' },
      { ...neutralTemplate, id: 'pia', style_preset: 'koe_pia' as const },
      { ...neutralTemplate, id: 'evidence', style_preset: 'abdaal_evidence' as const },
    ];
    const sorted = filterTemplates({}, 'koe_pia', catalog);
    expect(sorted.map((template) => template.id)).toEqual(['pia', 'neutral', 'evidence']);
  });

  test('adds the preferred rubric and contradiction requirement to scoring', () => {
    const deterministic: DeterministicResult = {
      formatting_score: 20,
      platform_hygiene_score: 20,
      checks: [],
      body_links: [],
      fold_text: 'Hook',
    };
    const prompt = buildImpactSystemPrompt({
      platform: 'linkedin',
      language: 'de',
      deterministic,
      productDescription: null,
      targetAudience: null,
      voiceTone: 'casual',
      creatorStyle: 'koe_pia',
    });
    expect(prompt).toContain('bevorzugt gegen');
    expect(prompt).toContain('Pain');
    expect(prompt).toContain('PIA-bezogene Verbesserung');
  });

  test('validates all supported values and rejects unknown styles', () => {
    for (const style of Object.keys(STYLE_PRESET_RULES)) {
      expect(creatorStyleSchema.parse(style)).toBe(style);
    }
    expect(() => creatorStyleSchema.parse('creator_imitation')).toThrow();
  });
});
