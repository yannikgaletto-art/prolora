'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Textarea } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { stepTransition } from '@/app/components/motion';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { FeatureState } from '@/lib/system/doctor';
import {
  ConnectRedditPanel,
  type RedditIntegrationStatus,
} from '@/app/components/ConnectRedditPanel';

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
// Two steps, because the old single-step version showed an unactionable "the
// operator must set REDDIT_CLIENT_ID" warning above a form that could not be
// submitted. When Reddit is not connected the dialog now opens on the connect
// step and advances to the ICP form by itself once it is.
export function AddCommunitiesButton({ featureState }: { featureState: FeatureState }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const redditBlocked = featureState.blocker === 'reddit_missing';
  const [reddit, setReddit] = useState<RedditIntegrationStatus>({
    connected: !redditBlocked,
    source: null,
    clientIdHint: null,
    verifiedAt: null,
    lastError: null,
  });
  const [step, setStep] = useState<'connect' | 'describe'>(
    redditBlocked ? 'connect' : 'describe'
  );

  // The server-rendered featureState is a snapshot; re-check on open so a
  // connection made in another tab (or in Settings) is reflected immediately.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchApi<RedditIntegrationStatus>('/v1/integrations/reddit')
      .then((status) => {
        if (cancelled) return;
        setReddit(status);
        setStep(status.connected ? 'describe' : 'connect');
      })
      .catch(() => {
        /* Falls back to the server-rendered featureState — no need to shout. */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const creditsBlocked =
    featureState.state !== 'ready' && featureState.blocker === 'ai_credits_exhausted';
  const canSubmit =
    reddit.connected &&
    !creditsBlocked &&
    productDescription.trim().length >= MIN_LENGTH &&
    targetAudience.trim().length >= MIN_LENGTH;

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
      setProductDescription('');
      setTargetAudience('');
      router.refresh();
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Communities</Button>

      <Modal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        dismissible={!submitting}
        size={step === 'connect' ? 'lg' : 'md'}
        title={step === 'connect' ? 'Connect Reddit' : 'Map your ICP to communities'}
        description={
          step === 'connect'
            ? 'Prolora reads Reddit with your own app key — one setup, then it stays connected.'
            : 'Describe your product and audience — Prolora finds relevant communities and checks their posting rules.'
        }
        footer={
          step === 'describe' ? (
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-communities-form"
                loading={submitting}
                disabled={!canSubmit || submitting}
              >
                {submitting ? 'Searching Reddit…' : 'Find Communities'}
              </Button>
            </>
          ) : undefined
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === 'connect' ? (
            <motion.div key="connect" {...stepTransition(reduced)}>
              <ConnectRedditPanel
                status={reddit}
                embedded
                onConnected={(status) => {
                  setReddit(status);
                  if (status.connected) {
                    setStep('describe');
                    setToast({ variant: 'success', message: 'Reddit connected.' });
                    router.refresh();
                  }
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="describe" {...stepTransition(reduced)}>
              <form id="add-communities-form" onSubmit={handleSubmit} className="space-y-4">
                {creditsBlocked && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-medium">No AI credits left</p>
                    <p className="mt-1">{featureState.hint}</p>
                  </div>
                )}

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
                    <CharHint
                      value={targetAudience}
                      max={1000}
                      label="Role, industry, pain point."
                    />
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

                {reddit.connected && reddit.source === 'workspace' && (
                  <button
                    type="button"
                    onClick={() => setStep('connect')}
                    className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                  >
                    Reddit connection settings
                  </button>
                )}
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
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
