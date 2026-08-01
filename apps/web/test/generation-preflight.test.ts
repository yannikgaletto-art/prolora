import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('manual generation preflight contract', () => {
  test('offers de, en, both and all three mention policies', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/publish/writer/GenerationPreflight.tsx'), 'utf8');
    expect(source).toMatch(/Deutsch/);
    expect(source).toMatch(/English/);
    expect(source).toMatch(/Beide/);
    expect(source).toMatch(/adaptive/);
    expect(source).toMatch(/include/);
    expect(source).toMatch(/exclude/);
  });

  test('writer run API requires an explicit manual language selection', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/api/v1/writer/run/route.ts'), 'utf8');
    expect(source).toMatch(/output_languages: z\.array\(z\.enum\(\['de', 'en'\]\)\)\.min\(1\)/);
    expect(source).toMatch(/product_mention_mode: z\.enum\(\['adaptive', 'include', 'exclude'\]\)/);
  });
});
