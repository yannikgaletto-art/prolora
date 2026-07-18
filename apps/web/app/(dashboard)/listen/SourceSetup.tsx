'use client';

import { useState } from 'react';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Input } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { FeatureState } from '@/lib/system/doctor';
import type { AppLocale } from '@prolora/shared';
import { getRun7Dict } from '@/lib/i18n/run7';

export function SourceSetup({
  initialWidgetConnected,
  initialRedditConnected,
  widgetCurl,
  redditState,
  locale,
}: {
  initialWidgetConnected: boolean;
  initialRedditConnected: boolean;
  widgetCurl: string | null;
  redditState: FeatureState;
  locale: AppLocale;
}) {
  const dict = getRun7Dict(locale).listen;
  const [widgetConnected, setWidgetConnected] = useState(initialWidgetConnected);
  const [redditConnected, setRedditConnected] = useState(initialRedditConnected);
  const [subreddits, setSubreddits] = useState('startups, SaaS');
  const [brandKeywords, setBrandKeywords] = useState('Prolora');
  const [widgetLoading, setWidgetLoading] = useState(false);
  const [redditLoading, setRedditLoading] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [redditError, setRedditError] = useState<string | null>(null);

  async function connectWidget() {
    setWidgetLoading(true);
    setWidgetError(null);
    try {
      await fetchApi('/v1/feedback/sources', {
        method: 'POST',
        body: JSON.stringify({ source_type: 'widget', config: { allowed_origins: [] } }),
      });
      setWidgetConnected(true);
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
      const list = (value: string) => value.split(',').map((item) => item.trim().replace(/^r\//, '')).filter(Boolean);
      await fetchApi('/v1/feedback/sources', {
        method: 'POST',
        body: JSON.stringify({ source_type: 'reddit', config: { subreddits: list(subreddits), brand_keywords: list(brandKeywords) } }),
      });
      setRedditConnected(true);
    } catch (caught) {
      setRedditError(errorMessage(caught));
    } finally {
      setRedditLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title={dict.widgetTitle}
        description={dict.widgetDescription}
      >
        {!widgetConnected ? (
          <Button type="button" loading={widgetLoading} disabled={!widgetCurl} onClick={() => void connectWidget()}>
            {dict.connectWidget}
          </Button>
        ) : (
          <p className="text-sm font-medium text-green-700">{dict.widgetConnected}</p>
        )}
        {widgetError && <p className="mt-2 text-sm text-red-600" role="alert">{widgetError}</p>}
        {widgetCurl ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
            <code>{widgetCurl}</code>
          </pre>
        ) : (
          <p className="mt-3 text-sm text-amber-700">{dict.slugRequired}</p>
        )}
      </Card>

      <Card title={dict.redditTitle} description={dict.redditDescription}>
        {redditState.state === 'ready' ? (
          redditConnected ? (
            <p className="text-sm font-medium text-green-700">{dict.redditConnected}</p>
          ) : (
            <div className="space-y-3">
              <Input label={dict.subreddits} value={subreddits} onChange={(event) => setSubreddits(event.target.value)} hint="Comma-separated, without r/." />
              <Input label={dict.brandKeywords} value={brandKeywords} onChange={(event) => setBrandKeywords(event.target.value)} hint="Comma-separated search terms." />
              <Button type="button" loading={redditLoading} disabled={!subreddits.trim() || !brandKeywords.trim()} onClick={() => void connectReddit()}>{dict.connectReddit}</Button>
            </div>
          )
        ) : (
          <div className="text-sm text-amber-800">
            <p>{redditState.hint}</p>
            {redditState.missing && <p className="mt-2 font-mono text-xs">{redditState.missing.join(' · ')}</p>}
          </div>
        )}
        {redditError && <p className="mt-2 text-sm text-red-600" role="alert">{redditError}</p>}
      </Card>
    </div>
  );
}
