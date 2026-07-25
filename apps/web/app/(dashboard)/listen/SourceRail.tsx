'use client';

// The source rail replaces the two always-on setup cards (F2 Listen). It
// answers the three questions the old layout did not: which sources exist,
// which are actually on, and how much of the feedback below came from each.
// Setup is progressive disclosure — a connected source costs one tile, not
// half the viewport, and the curl example lives behind a toggle instead of
// being the loudest element on the page.
//
// The connect calls are unchanged from the previous SourceSetup component:
// POST /v1/feedback/sources, same payload shape.

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/app/components/Button';
import { Input } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { FeatureState } from '@/lib/system/doctor';
import type { AppLocale } from '@prolora/shared';
import { getRun7Dict } from '@/lib/i18n/run7';
import { AllSourcesMark, SourceMark, sourceLabel, sourceWhat, type SourceKey } from './source-meta';

export type SourceStatus = 'connected' | 'not_connected' | 'blocked';

export interface SourceTile {
  key: SourceKey;
  /** The exact source_platform value this tile filters the list by. */
  platform: string;
  /** Overrides the generic 'other' label with the raw platform name. */
  label?: string;
  /** Items received in the summary window (30d). */
  count: number;
  status: SourceStatus;
}

const STATUS_DOT: Record<SourceStatus, string> = {
  connected: 'bg-green-500',
  not_connected: 'bg-gray-300',
  blocked: 'bg-amber-500',
};

const numberFormat = new Intl.NumberFormat('de-DE');

export function SourceRail({
  locale,
  tiles,
  total,
  initialWidgetConnected,
  initialRedditConnected,
  widgetCurl,
  redditState,
}: {
  locale: AppLocale;
  tiles: SourceTile[];
  total: number;
  initialWidgetConnected: boolean;
  initialRedditConnected: boolean;
  widgetCurl: string | null;
  redditState: FeatureState;
}) {
  const dict = getRun7Dict(locale).listen;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activePlatform = searchParams.get('platform');

  const [open, setOpen] = useState<SourceKey | null>(null);
  const [widgetConnected, setWidgetConnected] = useState(initialWidgetConnected);
  const [redditConnected, setRedditConnected] = useState(initialRedditConnected);
  const [subreddits, setSubreddits] = useState('startups, SaaS');
  const [brandKeywords, setBrandKeywords] = useState('Prolora');
  const [widgetLoading, setWidgetLoading] = useState(false);
  const [redditLoading, setRedditLoading] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [redditError, setRedditError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCurl, setShowCurl] = useState(false);

  function setPlatform(platform: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (platform) params.set('platform', platform);
    else params.delete('platform');
    params.delete('page');
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  async function connectWidget() {
    setWidgetLoading(true);
    setWidgetError(null);
    try {
      await fetchApi('/v1/feedback/sources', {
        method: 'POST',
        body: JSON.stringify({ source_type: 'widget', config: { allowed_origins: [] } }),
      });
      setWidgetConnected(true);
      setShowCurl(true);
      router.refresh();
    } catch (caught) {
      setWidgetError(errorMessage(caught));
    } finally {
      setWidgetLoading(false);
    }
  }

  async function connectReddit() {
    setRedditLoading(true);
    setRedditError(null);
    try {
      const list = (value: string) =>
        value.split(',').map((item) => item.trim().replace(/^r\//, '')).filter(Boolean);
      await fetchApi('/v1/feedback/sources', {
        method: 'POST',
        body: JSON.stringify({
          source_type: 'reddit',
          config: { subreddits: list(subreddits), brand_keywords: list(brandKeywords) },
        }),
      });
      setRedditConnected(true);
      router.refresh();
    } catch (caught) {
      setRedditError(errorMessage(caught));
    } finally {
      setRedditLoading(false);
    }
  }

  async function copyCurl() {
    if (!widgetCurl) return;
    try {
      await navigator.clipboard.writeText(widgetCurl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the text is selectable either way.
    }
  }

  // A connected tile filters; anything else opens its setup panel. Keeping one
  // action per tile means the whole tile can be a single <button>.
  function activate(tile: SourceTile) {
    if (tile.status === 'connected') {
      setPlatform(activePlatform === tile.platform ? null : tile.platform);
      return;
    }
    setOpen(open === tile.key ? null : tile.key);
  }

  const liveStatus = (tile: SourceTile): SourceStatus => {
    if (tile.key === 'widget' && widgetConnected) return 'connected';
    if (tile.key === 'reddit' && redditConnected) return 'connected';
    return tile.status;
  };

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{dict.sources}</h2>
        <p className="text-xs text-gray-500">{dict.sourcesHint}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        {/* "All sources" is the filter's off-state made visible, so clearing a
            source filter is a click in the same place you set it. */}
        <button
          type="button"
          aria-pressed={!activePlatform}
          onClick={() => setPlatform(null)}
          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
            !activePlatform
              ? 'border-primary-600 bg-primary-50/60 ring-1 ring-primary-600'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-2">
            <AllSourcesMark title={dict.allSources} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
              {dict.allSources}
            </span>
          </span>
          <span className="mt-2 block text-2xl font-semibold tracking-tight text-gray-900">
            {numberFormat.format(total)}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500">{dict.window30d}</span>
        </button>

        {tiles.map((tile) => {
          const status = liveStatus(tile);
          const label = tile.label ?? sourceLabel(dict, tile.key);
          const isActive = status === 'connected' && activePlatform === tile.platform;
          const isOpen = open === tile.key;

          return (
            <button
              key={tile.platform}
              type="button"
              aria-pressed={status === 'connected' ? isActive : isOpen}
              onClick={() => activate(tile)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                isActive
                  ? 'border-primary-600 bg-primary-50/60 ring-1 ring-primary-600'
                  : status === 'blocked'
                    ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <SourceMark source={tile.key} title={label} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {label}
                </span>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                  aria-hidden="true"
                />
              </span>

              {status === 'connected' ? (
                <>
                  <span className="mt-2 block text-2xl font-semibold tracking-tight text-gray-900">
                    {numberFormat.format(tile.count)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500">
                    {tile.count === 0
                      ? dict.nothingYet
                      : isActive
                        ? dict.filtered
                        : `${dict.connected} · ${dict.last30d}`}
                  </span>
                </>
              ) : (
                <>
                  <span className="mt-2 block text-sm font-medium text-gray-700">
                    {status === 'blocked' ? dict.blocked : dict.notConnected}
                  </span>
                  <span className="mt-0.5 block truncate text-xs font-medium text-primary-700">
                    {isOpen ? dict.close : `${dict.setUp} →`}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Secondary affordance for an already-connected widget: the test call is
          useful exactly once, so it must not compete with the numbers above. */}
      {widgetConnected && widgetCurl && (
        <div className="border-t border-gray-100 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setShowCurl((value) => !value)}
            className="text-xs font-medium text-primary-700 hover:text-primary-800"
          >
            {showCurl ? dict.hideTestCall : dict.showTestCall}
          </button>
          {showCurl && (
            <div className="mt-2 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">{dict.widgetDescription}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => void copyCurl()}>
                  {copied ? dict.copied : dict.copy}
                </Button>
              </div>
              <pre className="mt-2 max-w-full overflow-x-auto rounded-md bg-gray-950 p-3 text-xs leading-relaxed text-gray-100">
                <code>{widgetCurl}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {open === 'widget' && !widgetConnected && (
        <div className="min-w-0 border-t border-gray-200 bg-gray-50 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">{dict.widgetTitle}</h3>
          <p className="mt-1 text-sm text-gray-600">{sourceWhat(dict, 'widget')}</p>
          {widgetCurl ? (
            <Button
              type="button"
              className="mt-3"
              loading={widgetLoading}
              onClick={() => void connectWidget()}
            >
              {dict.connectWidget}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-amber-700">{dict.slugRequired}</p>
          )}
          {widgetError && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {widgetError}
            </p>
          )}
        </div>
      )}

      {open === 'reddit' && !redditConnected && (
        <div className="min-w-0 border-t border-gray-200 bg-gray-50 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">{dict.redditTitle}</h3>
          <p className="mt-1 text-sm text-gray-600">{sourceWhat(dict, 'reddit')}</p>
          {redditState.state === 'ready' ? (
            <div className="mt-3 max-w-md space-y-3">
              <Input
                label={dict.subreddits}
                value={subreddits}
                onChange={(event) => setSubreddits(event.target.value)}
                hint="startups, SaaS — ohne r/"
              />
              <Input
                label={dict.brandKeywords}
                value={brandKeywords}
                onChange={(event) => setBrandKeywords(event.target.value)}
                hint={sourceWhat(dict, 'reddit')}
              />
              <Button
                type="button"
                loading={redditLoading}
                disabled={!subreddits.trim() || !brandKeywords.trim()}
                onClick={() => void connectReddit()}
              >
                {dict.connectReddit}
              </Button>
            </div>
          ) : (
            <div className="mt-3 text-sm text-amber-800">
              <p>{redditState.hint}</p>
              {redditState.missing && (
                <p className="mt-2 font-mono text-xs">{redditState.missing.join(' · ')}</p>
              )}
            </div>
          )}
          {redditError && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {redditError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
