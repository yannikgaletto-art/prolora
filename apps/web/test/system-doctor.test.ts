import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemStatus, getBackgroundJobReadiness } from '../lib/system/doctor';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buildSystemStatus', () => {
  // Discovery used to be reported as blocked whenever Reddit was absent. With
  // Mastodon and Hacker News on public APIs that is simply false, and a false
  // "setup required" is the dead end this whole line of work removed — so the
  // regression guard is now that discovery stays *ready* without Reddit.
  it('keeps discovery ready without Reddit, and never names an env var the user cannot set', () => {
    const status = buildSystemStatus({
      plan: 'agency',
      creditsUsed: 12,
      configured: {
        anthropic: true,
        openai: true,
        reddit: false,
        linkedin: false,
        x: false,
        inngest: true,
      },
    });

    expect(status.features.discovery.state).toBe('ready');

    // Reddit *listening* genuinely reads Reddit and nothing else, so it stays
    // blocked — but self-serviceable, and described by a marker rather than the
    // names of env vars the user has no access to.
    expect(status.features.listen_reddit).toMatchObject({
      state: 'setup_required',
      selfServiceable: true,
      missing: ['REDDIT_APP'],
    });

    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain('sk-');
    expect(serialised).not.toContain('REDDIT_CLIENT_ID');
    expect(serialised).not.toContain('REDDIT_CLIENT_SECRET');
  });

  it('marks credit-backed AI features unavailable when the monthly quota is exhausted', () => {
    const status = buildSystemStatus({
      plan: 'pro',
      creditsUsed: 100,
      configured: {
        anthropic: true,
        openai: true,
        reddit: true,
        linkedin: true,
        x: true,
        inngest: true,
      },
    });

    expect(status.features.ai_drafts).toMatchObject({
      state: 'setup_required',
      missing: ['AI_CREDITS'],
    });
    expect(status.features.discovery.state).toBe('setup_required');
    expect(status.features.media_generation.state).toBe('ready');
    expect(status.plan).toEqual({
      name: 'pro',
      ai_credits_limit: 100,
      ai_credits_used: 100,
    });
  });

  it('keeps the no-key widget ready and labels absent background jobs honestly', () => {
    const status = buildSystemStatus({
      plan: 'starter',
      creditsUsed: 0,
      configured: {
        anthropic: true,
        openai: false,
        reddit: false,
        linkedin: false,
        x: false,
        inngest: false,
      },
    });

    expect(status.features.listen_widget.state).toBe('ready');
    expect(status.features.background_jobs).toMatchObject({
      state: 'setup_required',
      missing: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'],
    });
    expect(status.features.media_generation.missing).toEqual([
      'OPENAI_API_KEY',
      'INNGEST_EVENT_KEY',
      'INNGEST_SIGNING_KEY',
    ]);
  });

  // Regression (2026-07-22): media generation reported "ready" on the OpenAI
  // key alone — with a dead Inngest runtime the generate button charged the
  // budget and the row stayed 'pending' forever.
  it('marks media generation setup_required when only background jobs are missing', () => {
    const status = buildSystemStatus({
      plan: 'pro',
      creditsUsed: 0,
      configured: {
        anthropic: true,
        openai: true,
        reddit: true,
        linkedin: true,
        x: true,
        inngest: false,
      },
      inngestMissing: ['INNGEST_DEV_SERVER'],
    });

    expect(status.features.media_generation).toMatchObject({
      state: 'setup_required',
      missing: ['INNGEST_DEV_SERVER'],
    });
    expect(status.features.media_generation.hint).toContain('Inngest');
  });

  // BYO-OAuth: the blocker is the user's own developer app, which they enter in
  // the UI — so the hint must not send them to an env file they cannot reach.
  it('presents LinkedIn and X as self-serviceable without naming env variables', () => {
    for (const locale of ['de', 'en', 'es'] as const) {
      const status = buildSystemStatus({
        plan: 'pro',
        creditsUsed: 0,
        locale,
        configured: {
          anthropic: true,
          openai: true,
          reddit: true,
          linkedin: false,
          x: false,
          inngest: true,
        },
      });

      for (const feature of [status.features.connect_linkedin, status.features.connect_x]) {
        expect(feature.state).toBe('setup_required');
        expect(feature.selfServiceable).toBe(true);
        expect(feature.blocker).toBe('oauth_app_missing');
        expect(feature.hint).not.toMatch(/CLIENT_ID|CLIENT_SECRET/);
      }
    }

    const de = buildSystemStatus({
      plan: 'pro',
      creditsUsed: 0,
      locale: 'de',
      configured: { anthropic: true, openai: true, reddit: true, linkedin: false, x: false, inngest: true },
    });
    const es = buildSystemStatus({
      plan: 'pro',
      creditsUsed: 0,
      locale: 'es',
      configured: { anthropic: true, openai: true, reddit: true, linkedin: false, x: false, inngest: true },
    });
    expect(de.features.connect_x.hint).not.toBe(es.features.connect_x.hint);
  });

  it('reports LinkedIn and X ready once the workspace has its own app', () => {
    const status = buildSystemStatus({
      plan: 'pro',
      creditsUsed: 0,
      configured: {
        anthropic: true,
        openai: true,
        reddit: true,
        linkedin: true,
        x: true,
        inngest: true,
      },
    });
    expect(status.features.connect_linkedin.state).toBe('ready');
    expect(status.features.connect_x.state).toBe('ready');
  });

  it('checks the local Inngest dev server instead of treating key names as runtime readiness', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INNGEST_EVENT_KEY', '');
    vi.stubEnv('INNGEST_SIGNING_KEY', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getBackgroundJobReadiness()).resolves.toEqual({ ready: true, missing: [] });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8288/', expect.objectContaining({ cache: 'no-store' }));
  });
});

// Gemeldeter Fehler 2026-07-25: Der Nutzer hatte die Inngest-Keys in Vercel
// gesetzt und bekam trotzdem "KI-Generierung benötigt Einrichtung" mit BEIDEN
// Schlüsselnamen darunter — obwohl höchstens einer gefehlt haben kann.
describe('Inngest-Bereitschaft nennt nur den tatsächlich fehlenden Schlüssel', () => {
  it('nur der Signing-Key fehlt -> nur dieser wird gemeldet', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INNGEST_EVENT_KEY', 'evt_vorhanden');
    vi.stubEnv('INNGEST_SIGNING_KEY', '');
    await expect(getBackgroundJobReadiness()).resolves.toEqual({
      ready: false,
      missing: ['INNGEST_SIGNING_KEY'],
    });
  });

  it('nur der Event-Key fehlt -> nur dieser wird gemeldet', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INNGEST_EVENT_KEY', '');
    vi.stubEnv('INNGEST_SIGNING_KEY', 'signkey_vorhanden');
    await expect(getBackgroundJobReadiness()).resolves.toEqual({
      ready: false,
      missing: ['INNGEST_EVENT_KEY'],
    });
  });

  it('beide gesetzt -> bereit', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INNGEST_EVENT_KEY', 'evt');
    vi.stubEnv('INNGEST_SIGNING_KEY', 'sign');
    await expect(getBackgroundJobReadiness()).resolves.toEqual({ ready: true, missing: [] });
  });

  it('lokal mit echten Keys (Inngest Cloud) ist bereit, ohne den Dev-Server zu pingen', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INNGEST_EVENT_KEY', 'evt');
    vi.stubEnv('INNGEST_SIGNING_KEY', 'sign');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getBackgroundJobReadiness()).resolves.toEqual({ ready: true, missing: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Der Hinweis passt zur Umgebung', () => {
  const base = {
    plan: 'starter' as const,
    creditsUsed: 0,
    configured: { anthropic: true, openai: true, reddit: true, linkedin: true, x: true, inngest: false },
  };

  it('Deploy ohne Schlüssel: nennt Vercel-Umgebung und Neu-Deploy, nicht den Dev-Server', () => {
    const status = buildSystemStatus({ ...base, inngestMissing: ['INNGEST_SIGNING_KEY'] });
    const hint = status.features.media_generation.hint ?? '';
    expect(hint).toContain('Vercel');
    expect(hint).toContain('deploy');
    expect(hint).not.toContain('dev:jobs');
    expect(status.features.media_generation.missing).toEqual(['INNGEST_SIGNING_KEY']);
  });

  it('lokal ohne Dev-Server: nennt dev:jobs, nicht Vercel', () => {
    const status = buildSystemStatus({ ...base, inngestMissing: ['INNGEST_DEV_SERVER'] });
    const hint = status.features.media_generation.hint ?? '';
    expect(hint).toContain('dev:jobs');
    expect(hint).not.toContain('Vercel');
  });
});
