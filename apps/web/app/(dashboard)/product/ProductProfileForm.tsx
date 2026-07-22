'use client';

// Product setup form (GOAL-RUN9 §6 T0.3 — spec screen 2). Voice-first: every
// long text field carries the browser dictation from the template wizard.
// ProofAssets save immediately (own route); profile fields save on the button.
import { useState } from 'react';
import type { AppLocale, ProductProfileResponse, ProofAsset, ProofAssetType } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Textarea } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { useSpeechInput } from '../publish/templates/useSpeechInput';
import { getProductCopy } from '@/lib/i18n/product';

const PROOF_TYPES: ProofAssetType[] = [
  'metric',
  'founder_observation',
  'customer_quote',
  'case_study',
  'experiment',
];

interface Props {
  initialProfile: ProductProfileResponse;
  locale: AppLocale;
  workspaceName: string;
}

export function ProductProfileForm({ initialProfile, locale, workspaceName }: Props) {
  const copy = getProductCopy(locale);
  const speech = useSpeechInput(locale);

  const [description, setDescription] = useState(initialProfile.product_description ?? '');
  const [audience, setAudience] = useState(initialProfile.target_audience ?? '');
  const [coreValue, setCoreValue] = useState(initialProfile.core_value.join('\n'));
  const [founderPerspective, setFounderPerspective] = useState(
    initialProfile.founder_perspective ?? ''
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  const [assets, setAssets] = useState<ProofAsset[]>(initialProfile.proof_assets);
  const [newAssetType, setNewAssetType] = useState<ProofAssetType>('founder_observation');
  const [newAssetContent, setNewAssetContent] = useState('');
  const [assetState, setAssetState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [assetError, setAssetError] = useState('');

  function dictateInto(key: string, setter: (updater: (prev: string) => string) => void) {
    if (speech.activeKey === key) {
      speech.stop();
      return;
    }
    speech.start(key, (text) => {
      setter((prev) => (prev ? `${prev} ${text}` : text));
    });
  }

  function micButton(key: string, setter: (updater: (prev: string) => string) => void) {
    if (!speech.supported || speech.blocked) return null;
    const active = speech.activeKey === key;
    return (
      <button
        type="button"
        onClick={() => dictateInto(key, setter)}
        className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          active
            ? 'border-red-300 bg-red-50 text-red-700'
            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
        }`}
      >
        🎙 {active ? copy.dictate_stop : copy.dictate}
      </button>
    );
  }

  async function saveProfile() {
    setSaveState('saving');
    setSaveError('');
    try {
      await fetchApi('/v1/product/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product_description: description,
          target_audience: audience,
          founder_perspective: founderPerspective,
          core_value: coreValue
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 10),
        }),
      });
      setSaveState('saved');
    } catch (error) {
      setSaveError(errorMessage(error));
      setSaveState('error');
    }
  }

  async function addAsset() {
    if (newAssetContent.trim().length < 3) return;
    setAssetState('saving');
    setAssetError('');
    try {
      const result = await fetchApi<{ proof_asset: ProofAsset }>('/v1/product/proof-assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: newAssetType, content: newAssetContent.trim() }),
      });
      setAssets((prev) => [result.proof_asset, ...prev]);
      setNewAssetContent('');
      setAssetState('idle');
    } catch (error) {
      setAssetError(errorMessage(error));
      setAssetState('error');
    }
  }

  async function removeAsset(id: string) {
    const previous = assets;
    setAssets((prev) => prev.filter((asset) => asset.id !== id));
    try {
      await fetchApi(`/v1/product/proof-assets/${id}`, { method: 'DELETE' });
    } catch (error) {
      setAssets(previous);
      setAssetError(errorMessage(error));
      setAssetState('error');
    }
  }

  return (
    <div className="space-y-4">
      <Card title={workspaceName} description={copy.website_hint}>
        <div className="space-y-5">
          <div>
            <Textarea
              label={copy.section_what}
              hint={copy.section_what_help}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
            {micButton('description', (updater) => setDescription(updater))}
          </div>
          <div>
            <Textarea
              label={copy.section_audience}
              hint={copy.section_audience_help}
              rows={2}
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              maxLength={1000}
            />
          </div>
          <div>
            <Textarea
              label={copy.section_value}
              hint={copy.section_value_help}
              rows={4}
              value={coreValue}
              onChange={(e) => setCoreValue(e.target.value)}
            />
          </div>
          <div>
            <Textarea
              label={copy.section_founder}
              hint={copy.section_founder_help}
              rows={3}
              value={founderPerspective}
              onChange={(e) => setFounderPerspective(e.target.value)}
              maxLength={1000}
            />
            {micButton('founder', (updater) => setFounderPerspective(updater))}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveProfile} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? copy.saving : copy.save}
            </Button>
            {saveState === 'saved' && <p className="text-sm text-green-700">{copy.saved}</p>}
            {saveState === 'error' && (
              <p role="alert" className="text-sm text-red-700">
                {saveError || copy.save_error}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card title={copy.section_proof} description={copy.section_proof_help}>
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap gap-2">
              {PROOF_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNewAssetType(type)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    newAssetType === type
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {copy.proof_types[type]}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <Textarea
                rows={3}
                value={newAssetContent}
                onChange={(e) => setNewAssetContent(e.target.value)}
                placeholder={copy.proof_content_placeholder}
                maxLength={2000}
              />
              <div className="mt-2 flex items-center gap-2">
                {micButton('proof', (updater) => setNewAssetContent(updater))}
                <Button
                  onClick={addAsset}
                  disabled={assetState === 'saving' || newAssetContent.trim().length < 3}
                >
                  {copy.proof_add}
                </Button>
              </div>
              {assetState === 'error' && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {assetError}
                </p>
              )}
            </div>
          </div>

          {assets.length === 0 ? (
            <p className="text-sm text-gray-500">{copy.proof_empty}</p>
          ) : (
            <ul className="space-y-2">
              {assets.map((asset) => (
                <li
                  key={asset.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3"
                >
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {copy.proof_types[asset.type]}
                    </span>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{asset.content}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAsset(asset.id)}
                    className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600"
                  >
                    {copy.proof_delete}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
