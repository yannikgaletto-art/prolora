// Pure catalog filtering — no DB access (GOAL-RUN4 T0-3, Oracle 1).
import type {
  PlatformType,
  PostTemplate,
  TemplateFormat,
  TemplateIntent,
  TemplatePostType,
} from '@prolora/shared';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';

export interface TemplateFilter {
  intent?: TemplateIntent;
  post_type?: TemplatePostType;
  platform?: PlatformType;
  format?: TemplateFormat;
}

export function filterTemplates(filter: TemplateFilter = {}): PostTemplate[] {
  return TEMPLATE_CATALOG.filter((template) => {
    if (filter.intent && template.intent !== filter.intent) return false;
    if (filter.post_type && template.post_type !== filter.post_type) return false;
    if (filter.platform && !template.recommended_platforms.includes(filter.platform)) return false;
    if (filter.format && template.format !== filter.format) return false;
    return true;
  });
}

// Wizard question 2 — "Was hast du gerade zur Hand?" maps what the user HAS
// to the post types that turn it into a post (GOAL-RUN4 "Filter-Logik").
export const ASSET_TO_POST_TYPES: { key: string; label: string; postTypes: TemplatePostType[] }[] = [
  { key: 'zahl', label: 'Eine Zahl / ein Ergebnis', postTypes: ['transformation', 'product_demo'] },
  { key: 'wip', label: 'Screenshot / Fehler / Work-in-Progress', postTypes: ['build_in_public'] },
  { key: 'feature', label: 'Fertiges Feature / Workflow', postTypes: ['product_demo', 'tutorial'] },
  { key: 'meinung', label: 'Meinung nach Nutzung eines Tools', postTypes: ['review'] },
  { key: 'neu', label: 'Etwas Neues ist angekommen', postTypes: ['unboxing'] },
  { key: 'community', label: 'Community-Screenshot / Mitglieder-Erfolg', postTypes: ['community_fomo'] },
  { key: 'frage', label: 'Eine offene Entscheidung / Frage', postTypes: ['crowdsourcing'] },
  { key: 'nichts', label: 'Nichts Konkretes', postTypes: ['value_edu', 'lifestyle'] },
];
