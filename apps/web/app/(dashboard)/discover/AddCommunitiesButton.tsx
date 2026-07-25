'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Textarea } from '@/app/components/Input';
import { Badge } from '@/app/components/Badge';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { stepTransition, listItemTransition } from '@/app/components/motion';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { FeatureState } from '@/lib/system/doctor';
import {
  ConnectProviderPanel,
  type ProviderIntegrationStatus,
} from '@/app/components/ConnectProviderPanel';
import { getProviderDescriptor } from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';
import type { DiscoveryProviderStatus } from '@/lib/discovery/providers';

interface MapCommunitiesResponse {
  communities: unknown[];
  total: number;
}

const MIN_LENGTH = 10;

// Client island (F0-4, Pfad B): the only interactive piece on an otherwise
// server-rendered page. Calls POST /v1/discover/communities, then
// router.refresh() so the Server Component re-reads the now-updated
// discovery_communities table.
//
// Three steps, because discovery is no longer "Reddit or nothing". The dialog
// opens on the platform picker: Mastodon and Hacker News are pre-selected and
// need no setup, so a brand-new workspace can map communities immediately, and
// the platforms that *do* need setup are an optional detour rather than a wall.
export function AddCommunitiesButton({
  featureState,
  initialProviders,
}: {
  featureState: FeatureState;
  initialProviders: DiscoveryProviderStatus[];
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [providers, setProviders] = useState(initialProviders);
  const [selected, setSelected] = useState<IntegrationProvider[]>(() =>
    initialProviders.filter((p) => p.available).map((p) => p.provider)
  );
  const [step, setStep] = useState<'pick' | 'connect' | 'describe'>('pick');
  const [connecting, setConnecting] = useState<IntegrationProvider | null>(null);

  // The server-rendered snapshot can be stale: a credential added in another tab
  // (or in Settings) should show up the moment the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchApi<{ providers: DiscoveryProviderStatus[] }>('/v1/integrations')
      .then((response) => {
        if (cancelled) return;
        setProviders(response.providers);
        setSelected((current) => {
          const available = response.providers.filter((p) => p.available).map((p) => p.provider);
          const kept = current.filter((provider) => available.includes(provider));
          return kept.length > 0 ? kept : available;
        });
      })
      .catch(() => {
        /* Falls back to the server-rendered snapshot — no need to shout. */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const creditsBlocked =
    featureState.state !== 'ready' && featureState.blocker === 'ai_credits_exhausted';
  const canSubmit =
    selected.length > 0 &&
    !creditsBlocked &&
    productDescription.trim().length >= MIN_LENGTH &&
    targetAudience.trim().length >= MIN_LENGTH;

  function toggle(provider: IntegrationProvider) {
    setSelected((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider]
    );
  }

  async function refreshProviders() {
    try {
      const response = await fetchApi<{ providers: DiscoveryProviderStatus[] }>('/v1/integrations');
      setProviders(response.providers);
      return response.providers;
    } catch {
      return providers;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await fetchApi<MapCommunitiesResponse>('/v1/discover/communities', {
        method: 'POST',
        body: JSON.stringify({
          product_description: productDescription.trim(),
          target_audience: targetAudience.trim(),
          platforms: selected,
        }),
      });
      setToast({
        variant: result.total === 0 ? 'info' : 'success',
        message:
          result.total === 0
            ? 'No relevant communities matched — try describing the audience more specifically.'
            : `Found ${result.total} matching ${result.total === 1 ? 'community' : 'communities'}.`,
      });
      setOpen(false);
      setStep('pick');
      setProductDescription('');
      setTargetAudience('');
      router.refresh();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const titles: Record<typeof step, string> = {
    pick: 'Where should Prolora look?',
    connect: connecting ? `Connect ${getProviderDescriptor(connecting).label}` : 'Connect platform',
    describe: 'Map your ICP to communities',
  };
  const descriptions: Record<typeof step, string> = {
    pick: 'Two platforms work right away. The others need a one-time setup.',
    connect: 'One setup, then it stays connected.',
    describe:
      'Describe your product and audience — Prolora finds relevant communities and checks their posting rules.',
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Communities</Button>

      <Modal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        dismissible={!submitting}
        size={step === 'describe' ? 'md' : 'lg'}
        title={titles[step]}
        description={descriptions[step]}
        footer={
          step === 'pick' ? (
            <>
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setStep('describe')}
              >
                Continue
              </Button>
            </>
          ) : step === 'describe' ? (
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setStep('pick')}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                type="submit"
                form="add-communities-form"
                loading={submitting}
                disabled={!canSubmit || submitting}
              >
                {submitting ? 'Searching…' : 'Find Communities'}
              </Button>
            </>
          ) : (
            <Button variant="secondary" type="button" onClick={() => setStep('pick')}>
              Back
            </Button>
          )
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === 'pick' && (
            <motion.div key="pick" {...stepTransition(reduced)} className="space-y-2.5">
              {providers.map((provider, index) => (
                <ProviderRow
                  key={provider.provider}
                  index={index}
                  provider={provider}
                  reduced={reduced}
                  checked={selected.includes(provider.provider)}
                  onToggle={() => toggle(provider.provider)}
                  onSetup={() => {
                    setConnecting(provider.provider);
                    setStep('connect');
                  }}
                />
              ))}
            </motion.div>
          )}

          {step === 'connect' && connecting && (
            <motion.div key="connect" {...stepTransition(reduced)}>
              <ConnectProviderPanel
                provider={connecting}
                embedded
                status={statusFor(providers, connecting)}
                onConnected={(next) => {
                  if (!next.connected) return;
                  void refreshProviders().then((fresh) => {
                    const nowAvailable = fresh.find(
                      (entry) => entry.provider === connecting
                    )?.available;
                    if (nowAvailable) {
                      setSelected((current) =>
                        current.includes(connecting) ? current : [...current, connecting]
                      );
                    }
                    setStep('pick');
                    setToast({
                      variant: 'success',
                      message: `${getProviderDescriptor(connecting).label} connected.`,
                    });
                    router.refresh();
                  });
                }}
              />
            </motion.div>
          )}

          {step === 'describe' && (
            <motion.div key="describe" {...stepTransition(reduced)}>
              <form id="add-communities-form" onSubmit={handleSubmit} className="space-y-4">
                {creditsBlocked && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-medium">No AI credits left</p>
                    <p className="mt-1">{featureState.hint}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span>Searching:</span>
                  {selected.map((provider) => (
                    <Badge key={provider} tone={getProviderDescriptor(provider).tone}>
                      {getProviderDescriptor(provider).label}
                    </Badge>
                  ))}
                </div>

                <Textarea
                  label="Product description"
                  name="product_description"
                  rows={3}
                  minLength={MIN_LENGTH}
                  maxLength={2000}
                  required
                  value={productDescription}
                  onChange={(event) => setProductDescription(event.target.value)}
                  placeholder="A GDPR-compliant publishing API for DACH SaaS teams…"
                  hint={
                    <CharHint value={productDescription} max={2000} label="What you're building." />
                  }
                />
                <Textarea
                  label="Target audience"
                  name="target_audience"
                  rows={3}
                  minLength={MIN_LENGTH}
                  maxLength={1000}
                  required
                  value={targetAudience}
                  onChange={(event) => setTargetAudience(event.target.value)}
                  placeholder="Solo founders and small product teams running their own marketing…"
                  hint={
                    <CharHint value={targetAudience} max={1000} label="Role, industry, pain point." />
                  }
                />

                <AnimatePresence>
                  {formError && (
                    <motion.p
                      {...stepTransition(reduced)}
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                      role="alert"
                    >
                      {formError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}

function statusFor(
  providers: DiscoveryProviderStatus[],
  provider: IntegrationProvider
): ProviderIntegrationStatus {
  const entry = providers.find((item) => item.provider === provider);
  return {
    connected: entry?.available ?? false,
    source: null,
    clientIdHint: null,
    verifiedAt: null,
    lastError: null,
  };
}

function ProviderRow({
  provider,
  index,
  reduced,
  checked,
  onToggle,
  onSetup,
}: {
  provider: DiscoveryProviderStatus;
  index: number;
  reduced: boolean | null;
  checked: boolean;
  onToggle: () => void;
  onSetup: () => void;
}) {
  const descriptor = getProviderDescriptor(provider.provider);

  return (
    <motion.div
      {...listItemTransition(reduced, index)}
      className={`rounded-lg border p-3.5 transition-colors ${
        provider.available && checked
          ? 'border-primary-600 bg-primary-50/40'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        {provider.available ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
            aria-label={`Search ${descriptor.label}`}
          />
        ) : (
          <span className="mt-1 h-4 w-4 shrink-0 rounded border border-dashed border-gray-300" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{descriptor.label}</p>
            {descriptor.credentialKind === 'none' && <Badge tone="green">No setup</Badge>}
            {!provider.available && <Badge tone="amber">Setup required</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{descriptor.summary}</p>
          {descriptor.caveat && (
            <p className="mt-1 text-xs text-gray-500">{descriptor.caveat}</p>
          )}
        </div>

        {!provider.available && (
          <Button variant="secondary" size="sm" type="button" onClick={onSetup}>
            {provider.reason === 'connect_bluesky_first' ? 'How' : 'Set up'}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// Live length feedback: the API enforces a 10-character minimum, and the old
// dialog only surfaced that as a browser validation bubble after submitting.
function CharHint({ value, max, label }: { value: string; max: number; label: string }) {
  const length = value.trim().length;
  const tooShort = length > 0 && length < MIN_LENGTH;
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className={tooShort ? 'text-amber-700' : undefined}>
        {tooShort ? `At least ${MIN_LENGTH} characters.` : label}
      </span>
      {length > 0 && (
        <span className={`shrink-0 tabular-nums ${length > max * 0.9 ? 'text-amber-700' : 'text-gray-400'}`}>
          {length}/{max}
        </span>
      )}
    </span>
  );
}
