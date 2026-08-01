'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/app/components/Button';
import { Input, Textarea } from '@/app/components/Input';
import {
  dnaConfidenceTier,
  type WriterDna,
  type WriterSampleKind,
  type WriterSampleOrigin,
} from './writer-model';
import type { WriterCopy } from './writer-copy';

const SAMPLE_ORIGINS: readonly WriterSampleOrigin[] = ['pasted', 'imported', 'published'];

export interface AddWriterSampleInput {
  kind: WriterSampleKind;
  origin: WriterSampleOrigin;
  label: string;
  content: string;
  sourceUrl?: string;
  sourcePostItemId?: string;
}

export function ContentDnaPanel({
  dna,
  copy,
  disabled,
  busy,
  onAddSample,
  onRebuild,
  onImportBundle,
}: {
  dna: WriterDna;
  copy: WriterCopy;
  disabled: boolean;
  busy?: 'sample' | 'rebuild' | 'import' | null;
  onAddSample?: (input: AddWriterSampleInput) => Promise<void>;
  onRebuild?: () => Promise<void>;
  onImportBundle?: () => Promise<void>;
}) {
  const [kind, setKind] = useState<WriterSampleKind>('golden');
  const [origin, setOrigin] = useState<WriterSampleOrigin>('pasted');
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const tier = dna.confidence ?? dnaConfidenceTier(dna.goldenSampleCount);
  const confidenceHint = copy.dna.confidence[`${tier}Hint`];
  const activeSamples = useMemo(() => dna.samples.filter((sample) => sample.active), [dna.samples]);

  async function submitSample(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !onAddSample ||
      !content.trim() ||
      (origin !== 'pasted' && !sourceReference.trim())
    ) {
      return;
    }
    await onAddSample({
      kind,
      origin,
      label: label.trim(),
      content: content.trim(),
      ...(origin === 'imported'
        ? { sourceUrl: sourceReference.trim() }
        : origin === 'published'
          ? { sourcePostItemId: sourceReference.trim() }
          : {}),
    });
    setLabel('');
    setContent('');
    setSourceReference('');
  }

  return (
    <section
      id="writer-panel-dna"
      role="tabpanel"
      aria-labelledby="writer-tab-dna"
      className="space-y-6"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div className="overflow-hidden rounded-3xl border border-gray-200/80 bg-white shadow-[0_20px_60px_-35px_rgba(15,23,42,0.3)]">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600">
                  {copy.dna.version} {dna.version ?? '—'}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-950">
                  {copy.dna.title}
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                  {copy.dna.subtitle}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === 'import'}
                  disabled={disabled || Boolean(busy)}
                  onClick={() => void onImportBundle?.()}
                  className="min-h-11 shrink-0"
                >
                  12 Golden Samples importieren
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === 'rebuild'}
                  disabled={disabled || dna.goldenSampleCount < 3}
                  onClick={() => void onRebuild?.()}
                  className="min-h-11 shrink-0"
                >
                  {busy === 'rebuild' ? copy.dna.rebuilding : copy.dna.rebuild}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-gray-100 sm:grid-cols-3">
            <DnaMetric label={copy.dna.samples} value={activeSamples.length} />
            <DnaMetric label={copy.dna.golden} value={dna.goldenSampleCount} accent="primary" />
            <DnaMetric label={copy.dna.avoid} value={dna.avoidSampleCount} accent="rose" />
          </div>

          <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">{copy.dna.traits}</h3>
              {dna.traits.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {dna.traits.map((trait) => (
                    <li
                      key={trait}
                      className="flex gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 text-sm leading-5 text-gray-700"
                    >
                      <span aria-hidden="true" className="mt-1 text-primary-500">
                        ◆
                      </span>
                      <span>{trait}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm leading-6 text-gray-500">{copy.dna.noTraits}</p>
              )}
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-950">
                <span aria-hidden="true">⌁</span>
                {copy.dna.lockedRules}
              </h3>
              {dna.lockedRules.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {dna.lockedRules.map((rule) => (
                    <li
                      key={rule}
                      className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-sm leading-5 text-amber-950"
                    >
                      <span className="mr-2" aria-hidden="true">
                        🔒
                      </span>
                      {rule}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm leading-6 text-gray-500">{copy.dna.noLockedRules}</p>
              )}
              <p className="mt-3 text-xs leading-5 text-gray-400">{copy.dna.lockedHint}</p>
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-primary-100 bg-primary-50/60 p-5 shadow-[0_20px_50px_-35px_rgba(37,99,235,0.55)] sm:p-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white text-primary-700 shadow-sm ring-1 ring-primary-100"
            >
              ◌
            </span>
            <div>
              <p className="text-sm font-semibold text-primary-950">
                {copy.dna.confidence[tier]}
              </p>
              <p className="mt-1 text-sm leading-6 text-primary-900/70">{confidenceHint}</p>
            </div>
          </div>
          <div
            className="mt-5 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-primary-100"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full bg-primary-500 transition-[width] duration-500 motion-reduce:transition-none ${
                tier === 'low'
                  ? 'w-1/5'
                  : tier === 'preliminary'
                    ? 'w-2/5'
                    : tier === 'reliable'
                      ? 'w-3/4'
                      : 'w-full'
              }`}
            />
          </div>
          <p className="mt-3 text-xs text-primary-800/70">
            {dna.goldenSampleCount} {copy.dna.golden} · {dna.avoidSampleCount} {copy.dna.avoid}
          </p>
        </aside>
      </div>

      <form
        onSubmit={(event) => void submitSample(event)}
        className="rounded-3xl border border-gray-200/80 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.25)] sm:p-7"
      >
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight text-gray-950">
            {copy.dna.addSample}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">{copy.dna.subtitle}</p>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-gray-900">{copy.dna.sampleKind}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['golden', 'avoid'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={kind === option}
                    disabled={disabled}
                    onClick={() => setKind(option)}
                    className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50 ${
                      kind === option
                        ? option === 'golden'
                          ? 'border-primary-300 bg-primary-50 text-primary-800'
                          : 'border-rose-300 bg-rose-50 text-rose-800'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {option === 'golden' ? copy.dna.golden : copy.dna.avoid}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-gray-900">{copy.dna.sampleOrigin}</legend>
              <div className="mt-2 space-y-2">
                {SAMPLE_ORIGINS.map((option) => (
                  <label
                    key={option}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition-colors motion-reduce:transition-none ${
                      origin === option
                        ? 'border-primary-300 bg-primary-50 text-primary-900'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="writer-sample-origin"
                      value={option}
                      checked={origin === option}
                      disabled={disabled}
                      onChange={() => {
                        setOrigin(option);
                        setSourceReference('');
                      }}
                      className="size-4 accent-primary-600"
                    />
                    {copy.dna.origins[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-4">
            <Input
              name="writer-sample-label"
              label={copy.dna.sampleLabel}
              value={label}
              disabled={disabled}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
            {origin !== 'pasted' && (
              <Input
                name="writer-sample-source"
                type={origin === 'imported' ? 'url' : 'text'}
                label={origin === 'imported' ? copy.dna.sampleUrl : copy.dna.publishedPost}
                value={sourceReference}
                disabled={disabled}
                required
                onChange={(event) => setSourceReference(event.target.value)}
              />
            )}
            <Textarea
              name="writer-sample-content"
              label={copy.dna.sampleContent}
              value={content}
              disabled={disabled}
              required
              rows={8}
              minLength={40}
              maxLength={20_000}
              onChange={(event) => setContent(event.target.value)}
            />
            <Button
              type="submit"
              loading={busy === 'sample'}
              disabled={
                disabled ||
                content.trim().length < 40 ||
                (origin !== 'pasted' && !sourceReference.trim())
              }
              className="min-h-11 w-full sm:w-auto"
            >
              {busy === 'sample' ? copy.dna.adding : copy.dna.add}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function DnaMetric({
  label,
  value,
  accent = 'gray',
}: {
  label: string;
  value: number;
  accent?: 'gray' | 'primary' | 'rose';
}) {
  return (
    <div className="bg-white px-5 py-4 sm:px-7">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          accent === 'primary'
            ? 'text-primary-700'
            : accent === 'rose'
              ? 'text-rose-700'
              : 'text-gray-950'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
