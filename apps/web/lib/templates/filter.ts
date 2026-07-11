// Pure catalog filtering — no DB access (Oracle O1). Used by the REST API
// (GET /v1/templates). The wizard's second level ("Was hast du zur Hand?")
// moved to lib/templates/guide.ts in GOAL-RUN5: templates now declare explicit
// anlass_keys and ANLASS_INFO carries the labels/examples.
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
