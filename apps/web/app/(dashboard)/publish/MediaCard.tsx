'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import type { AppLocale, MediaItem } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Textarea } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { FeatureState } from '@/lib/system/doctor';
import {
  normalizeMediaFormat,
  shouldPollGeneration,
  type ComposerMediaFormat,
  type ComposerMediaKind,
  type GenerationStatus,
} from './media-card-logic';
import { getRun7Dict } from '@/lib/i18n/run7';

interface BudgetResponse {
  budget: { limit_eur: number; spent_eur: number; remaining_eur: number };
  estimates: { image_eur: number; video_eur: number };
}

interface GenerationCandidate {
  id: string;
  kind: ComposerMediaKind;
  status: GenerationStatus;
  storage_key: string | null;
  mime_type: string | null;
  preview_url: string | null;
  error_message: string | null;
}

export function MediaCard({
  featureState,
  locale,
  onUse,
}: {
  featureState: FeatureState;
  locale: AppLocale;
  onUse: (media: MediaItem, previewUrl: string | null) => void;
}) {
  const dict = getRun7Dict(locale).media;
  const [kind, setKind] = useState<ComposerMediaKind>('image');
  const [format, setFormat] = useState<ComposerMediaFormat>('square');
  const [prompt, setPrompt] = useState('');
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [candidate, setCandidate] = useState<GenerationCandidate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);

  useEffect(() => {
    if (featureState.state !== 'ready') return;
    void fetchApi<BudgetResponse>('/v1/media/generations').then(setBudget).catch(() => undefined);
  }, [featureState.state]);

  useEffect(() => {
    if (!candidate || !shouldPollGeneration(candidate.status)) return;
    const timer = window.setTimeout(() => {
      void fetchApi<{ generation: GenerationCandidate }>(`/v1/media/generations/${candidate.id}`)
        .then((response) => {
          setCandidate(response.generation);
          setPollAttempt(0);
          setError(null);
        })
        .catch((caught) => {
          setError(errorMessage(caught));
          setPollAttempt((attempt) => Math.min(attempt + 1, 5));
        });
    }, Math.min(2000 * 2 ** pollAttempt, 30_000));
    return () => window.clearTimeout(timer);
  }, [candidate, pollAttempt]);

  function changeKind(next: ComposerMediaKind) {
    setKind(next);
    setFormat((current) => normalizeMediaFormat(next, current));
  }

  async function generate() {
    if (prompt.trim().length < 3 || featureState.state !== 'ready') return;
    if (kind === 'video' && !window.confirm('Generate an 8-second Sora video? Video costs more and can take several minutes.')) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchApi<{
        generation: { id: string; kind: ComposerMediaKind; status: GenerationStatus };
        budget: BudgetResponse['budget'];
      }>('/v1/media/generations', {
        method: 'POST',
        body: JSON.stringify({ kind, prompt: prompt.trim(), format }),
      });
      setBudget((current) => current ? { ...current, budget: response.budget } : current);
      setCandidate({
        ...response.generation,
        storage_key: null,
        mime_type: null,
        preview_url: null,
        error_message: null,
      });
      setPollAttempt(0);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetchApi<{ media_item: MediaItem; preview_url: string | null }>(
        '/v1/media/uploads',
        { method: 'POST', body: form }
      );
      onUse(response.media_item, response.preview_url);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  const estimate = budget?.estimates[kind === 'image' ? 'image_eur' : 'video_eur'];

  return (
    <Card title={dict.title} description={dict.description}>
      <div className="space-y-4">
        {featureState.state !== 'ready' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{dict.setupTitle}</p>
            <p className="mt-1">{featureState.hint}</p>
            {featureState.missing && <p className="mt-1 font-mono text-xs">{featureState.missing.join(' · ')}</p>}
            <p className="mt-2 text-xs">{dict.uploadsAvailable}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={kind === 'image' ? 'primary' : 'secondary'} onClick={() => changeKind('image')}>{dict.generateImage}</Button>
          <Button type="button" variant={kind === 'video' ? 'primary' : 'secondary'} onClick={() => changeKind('video')}>{dict.generateVideo}</Button>
          <label className="inline-flex cursor-pointer items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            {uploading ? dict.uploading : dict.upload}
            <input type="file" className="sr-only" accept="image/*,video/mp4,video/quicktime,application/pdf" disabled={uploading} onChange={(event) => void upload(event)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          {(['square', 'portrait', 'landscape'] as const).map((value) => (
            <label key={value} className={`flex items-center gap-2 text-sm ${kind === 'video' && value === 'square' ? 'text-gray-400' : 'text-gray-800'}`}>
              <input type="radio" name="media-format" value={value} checked={format === value} disabled={kind === 'video' && value === 'square'} onChange={() => setFormat(value)} />
              {dict[value]}
            </label>
          ))}
        </div>

        <Textarea label={dict.prompt} rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={dict.promptPlaceholder} disabled={featureState.state !== 'ready'} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
          <span>{estimate != null ? `${dict.estimate} €${estimate.toFixed(2)}` : dict.estimateLoading}</span>
          <span>{budget ? `€${budget.budget.remaining_eur.toFixed(2)} / €${budget.budget.limit_eur.toFixed(2)} ${dict.budgetRemaining}` : ''}</span>
        </div>
        <Button type="button" loading={submitting} disabled={featureState.state !== 'ready' || prompt.trim().length < 3} onClick={() => void generate()}>{dict.generate}</Button>

        {candidate && (
          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-900">{dict.generation}: {candidate.status}</p>
            {candidate.preview_url && candidate.kind === 'image' && <img src={candidate.preview_url} alt="Generated media preview" className="mt-3 max-h-80 rounded-md object-contain" />}
            {candidate.preview_url && candidate.kind === 'video' && <video src={candidate.preview_url} controls className="mt-3 max-h-80 rounded-md" />}
            {candidate.error_message && <p className="mt-2 text-sm text-red-600">{candidate.error_message}</p>}
            <div className="mt-3 flex gap-2">
              {candidate.status === 'succeeded' && candidate.storage_key && candidate.mime_type && (
                <Button type="button" onClick={() => {
                  onUse({ type: candidate.kind, url: candidate.storage_key!, mime_type: candidate.mime_type ?? undefined }, candidate.preview_url);
                  setCandidate(null);
                }}>{dict.use}</Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setCandidate(null)}>{dict.discard}</Button>
              {candidate.status === 'succeeded' && <Button type="button" variant="ghost" onClick={() => void generate()}>{dict.generateAgain}</Button>}
              {shouldPollGeneration(candidate.status) && error && (
                <Button type="button" variant="ghost" onClick={() => { setError(null); setPollAttempt((attempt) => attempt + 1); }}>{dict.retryStatus}</Button>
              )}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    </Card>
  );
}
