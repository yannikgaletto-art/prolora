import { describe, expect, test } from 'vitest';
import { createWriterDemoData } from '@/app/(dashboard)/publish/writer/writer-demo';

describe('Writer local test mode', () => {
  test('provides an approval-ready, non-publishable walkthrough without database state', () => {
    const data = createWriterDemoData('Acme');

    expect(data.availability).toBe('ready');
    expect(data.policy.enabled).toBe(false);
    expect(data.pendingReview?.channels).toHaveLength(1);
    expect(data.pendingReview?.claims).toHaveLength(2);
    expect(data.dna.goldenSampleCount).toBe(3);
    expect(data.history).toEqual([]);
  });
});
