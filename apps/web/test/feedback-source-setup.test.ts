import { describe, expect, it } from 'vitest';
import { buildWidgetCurl } from '../lib/feedback/source-setup';
import { getRun7Dict } from '../lib/i18n/run7';

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

  // Regression guard for the mixed-language Listen screen: the three empty
  // states used to be two hardcoded strings, one German and one English, and
  // they collapsed "no source at all" into "no match for your filters".
  it('has three distinct, fully localized empty states', () => {
    for (const locale of ['de', 'en', 'es'] as const) {
      const dict = getRun7Dict(locale).listen;
      const titles = [dict.emptyNoSourceTitle, dict.emptyWaitingTitle, dict.emptyFilteredTitle];
      expect(new Set(titles).size, locale).toBe(3);
      for (const title of titles) expect(title.length, `${locale}: ${title}`).toBeGreaterThan(0);
    }
    // Same slot, different language in each dictionary — no English fallback
    // leaking into the German screen.
    const slot = (['de', 'en', 'es'] as const).map((l) => getRun7Dict(l).listen.emptyNoSourceTitle);
    expect(new Set(slot).size).toBe(3);
  });
});
