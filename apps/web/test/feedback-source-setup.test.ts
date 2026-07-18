import { describe, expect, it } from 'vitest';
import { buildWidgetCurl, listenEmptyState } from '../lib/feedback/source-setup';

describe('feedback source setup', () => {
  it('builds a copyable public widget request for the workspace slug', () => {
    const curl = buildWidgetCurl('https://app.prolora.eu', 'acme-demo');
    expect(curl).toContain('https://app.prolora.eu/api/v1/feedback/widget');
    expect(curl).toContain('"workspace":"acme-demo"');
    expect(curl.split('\n')).toEqual([
      "curl -X POST 'https://app.prolora.eu/api/v1/feedback/widget' \\",
      "  -H 'Content-Type: application/json' \\",
      expect.stringMatching(/^  -d '/),
    ]);
    expect(curl).not.toContain('\n+');
    expect(curl).not.toMatch(/token|secret|api[_-]?key/i);
  });

  it('distinguishes no source from filters with no matching feedback', () => {
    expect(listenEmptyState(false)).toMatchObject({
      title: 'Noch keine Quelle verbunden',
      showSourceSetup: true,
    });
    expect(listenEmptyState(true)).toMatchObject({
      title: 'No feedback matches these filters',
      showSourceSetup: false,
    });
  });
});
