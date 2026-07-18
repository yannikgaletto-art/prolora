import { describe, expect, it } from 'vitest';
import { adaptationLanguageInstruction } from '../lib/ai/adapt-content';

describe('adaptation language', () => {
  it('uses the configured voice language independently of UI or source language', () => {
    expect(adaptationLanguageInstruction('es')).toContain('es');
    expect(adaptationLanguageInstruction('es')).not.toMatch(/same language as the source/i);
    expect(adaptationLanguageInstruction(null)).toContain('source language');
  });
});
