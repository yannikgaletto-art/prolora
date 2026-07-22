import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemStatus, getBackgroundJobReadiness } from '../lib/system/doctor';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buildSystemStatus', () => {
  it('explains missing Reddit configuration without exposing secret values', () => {
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

    expect(status.features.discovery).toMatchObject({
      state: 'setup_required',
      missing: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    });
    expect(status.features.listen_reddit.state).toBe('setup_required');
    expect(JSON.stringify(status)).not.toContain('sk-');
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

  it('checks the local Inngest dev server instead of treating key names as runtime readiness', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getBackgroundJobReadiness()).resolves.toEqual({ ready: true, missing: [] });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8288/', expect.objectContaining({ cache: 'no-store' }));
  });
});
