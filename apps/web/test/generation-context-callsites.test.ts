import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('shared generation context call sites', () => {
  test.each([
    ['templates', ['lib/templates/draft-service.ts']],
    ['compose adaptation', ['lib/posts/create-post.ts', 'lib/ai/adapt-content.ts']],
    ['pillar splinters', ['lib/content/splinter.ts']],
    ['community replies', ['lib/discovery/draft-assist.ts']],
  ])('%s resolves context and runs narrative QA', (_label, paths) => {
    const code = paths.map(source).join('\n');
    expect(code).toMatch(/resolveManualGenerationContexts/);
    expect(code).toMatch(/assertGroundedDraft/);
  });

  test('manual generation routes require explicit language and mention policy', () => {
    const validation = source('../../packages/shared/validation.ts');
    const adaptRoute = source('app/api/v1/content/adapt/route.ts');
    const splinterRoute = source('app/api/v1/content/sources/[id]/splinter/route.ts');
    for (const code of [validation, adaptRoute, splinterRoute]) {
      expect(code).toMatch(/output_language/);
      expect(code).toMatch(/product_mention_mode/);
    }
  });

  test('community drafts retain their dedicated compliance re-check', () => {
    const code = source('lib/ai/draft-reply.ts');
    expect(code).toMatch(/checkCompliance/);
    expect(code).toMatch(/generationContext\.mention\.decision/);
  });

  test('analytical concept helpers do not load personal samples', () => {
    const angleRoute = source('app/api/v1/concepts/angles/route.ts');
    const discoveryConfiguration = source('lib/discovery/auto-context.ts');
    expect(angleRoute).not.toMatch(/resolveGenerationContext|content_samples/);
    expect(discoveryConfiguration).not.toMatch(/content_samples/);
  });
});
