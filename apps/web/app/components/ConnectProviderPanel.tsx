'use client';

// One panel for every integration, rendered from its descriptor
// (lib/integrations/registry.ts) instead of from hard-coded JSX.
//
// This replaces ConnectRedditPanel, whose three-step Reddit instruction lived in
// markup — which meant the second provider would have needed a second panel, and
// the third a third. Now a provider contributes setup steps, fields and a deep
// link as data, and the three credential kinds each get exactly one rendering:
//
//   none             -> nothing to do, say so and get out of the way
//   api_key          -> walk-through + derived form + live verification
//   reuse_connection -> point at the place inside Prolora that already has it
//
// Credentials go to PUT /api/v1/integrations/{provider} and are encrypted
// server-side; nothing sensitive stays in component state after a save.

import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { Button } from './Button';
import { Input } from './Input';
import { stepTransition } from './motion';
import { fetchApi, errorMessage } from '@/app/lib/api';
import {
  credentialFieldsFor,
  getProviderDescriptor,
  type ProviderSetupStep,
} from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

/** The non-secret half of an integration — what the browser may know. */
export interface ProviderIntegrationStatus {
  connected: boolean;
  source: 'workspace' | 'environment' | null;
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

interface Props {
  provider: IntegrationProvider;
  status: ProviderIntegrationStatus;
  onConnected: (status: ProviderIntegrationStatus) => void;
  /** Rendered inside a modal — drop the outer card chrome. */
  embedded?: boolean;
}

export function ConnectProviderPanel({ provider, status, onConnected, embedded = false }: Props) {
  const descriptor = getProviderDescriptor(provider);
  const fields = credentialFieldsFor(descriptor);
  const reduced = useReducedMotion();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!status.connected);

  const wrapper = embedded ? '' : 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      for (const field of fields) body[field.name] = (values[field.name] ?? '').trim();

      const next = await fetchApi<ProviderIntegrationStatus>(`/v1/integrations/${provider}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      // Clear the secrets from memory the moment they are no longer needed.
      setValues({});
      setShowForm(false);
      onConnected(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    setError(null);
    try {
      const next = await fetchApi<ProviderIntegrationStatus>(`/v1/integrations/${provider}`, {
        method: 'DELETE',
      });
      setShowForm(true);
      onConnected(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  // --- credentialKind 'none': there is genuinely nothing to do here ---
  if (descriptor.credentialKind === 'none') {
    return (
      <motion.div {...stepTransition(reduced)} className={wrapper}>
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-900">{descriptor.label} is ready</p>
          <p className="mt-0.5 text-xs text-green-800">{descriptor.summary}</p>
          {descriptor.caveat && (
            <p className="mt-1.5 text-xs text-green-800/80">{descriptor.caveat}</p>
          )}
        </div>
      </motion.div>
    );
  }

  // --- credentialKind 'reuse_connection': send them where the credential is ---
  if (descriptor.credentialKind === 'reuse_connection') {
    return (
      <motion.div {...stepTransition(reduced)} className={wrapper}>
        {status.connected ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-900">{descriptor.label} connected</p>
            <p className="mt-0.5 text-xs text-green-800">{descriptor.summary}</p>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              Connect {descriptor.label} under Channels first
            </p>
            <p className="mt-0.5 text-xs text-amber-800">{descriptor.summary}</p>
            {descriptor.connectDeepLink && (
              <Link
                href={descriptor.connectDeepLink}
                className="mt-2.5 inline-flex items-center rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-50"
              >
                {descriptor.connectCta}
              </Link>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  // --- credentialKind 'api_key' ---
  if (status.connected && !showForm) {
    return (
      <motion.div {...stepTransition(reduced)} className={wrapper}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-green-900">{descriptor.label} connected</p>
            <p className="mt-0.5 text-xs text-green-800">
              {status.source === 'environment'
                ? `Using the server-configured ${descriptor.label} app.`
                : status.clientIdHint
                  ? `App ${status.clientIdHint.slice(0, 6)}… · verified`
                  : `Verified against ${descriptor.label}.`}
            </p>
          </div>
          {status.source === 'workspace' && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDisconnect} loading={saving}>
                Disconnect
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div {...stepTransition(reduced)} className={wrapper}>
      {descriptor.setupSteps.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">
            Connect {descriptor.label}
            {descriptor.setupTimeHint ? ` — ${descriptor.setupTimeHint}` : ''}
          </p>
          <ol className="mt-3 space-y-2.5 text-sm text-gray-600">
            {descriptor.setupSteps.map((step, index) => (
              <li key={step.text} className="flex gap-2.5">
                <StepDot>{index + 1}</StepDot>
                <SetupStepBody step={step} />
              </li>
            ))}
          </ol>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        {fields.map((field) => (
          <Input
            key={field.name}
            label={field.label}
            name={`${provider}_${field.name}`}
            type={field.type === 'password' ? 'password' : 'text'}
            value={values[field.name] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.name]: event.target.value }))
            }
            autoComplete="off"
            spellCheck={false}
            required
            minLength={field.minLength}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            hint={field.hint}
          />
        ))}

        <AnimatePresence>
          {error && (
            <motion.p
              {...stepTransition(reduced)}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={saving} size="sm">
            {saving ? `Verifying with ${descriptor.label}…` : descriptor.connectCta}
          </Button>
          {status.connected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </motion.div>
  );
}

function SetupStepBody({ step }: { step: ProviderSetupStep }) {
  // The app's own origin: providers demand a redirect URI even for app-only
  // access that never redirects anywhere, and this is a real URL that satisfies
  // the field without implying a callback route.
  const appOrigin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <span>
      {step.text}
      {step.link && (
        <>
          {' '}
          <a
            href={step.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800"
          >
            {step.link.label}
          </a>
        </>
      )}
      {step.textAfter && <> {step.textAfter}</>}
      {step.copyValue === 'app_origin' && <CopyField value={appOrigin} />}
      {step.note && <span className="mt-1 block text-xs text-gray-500">{step.note}</span>}
    </span>
  );
}

function StepDot({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
      {children}
    </span>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1.5 flex items-stretch gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-700">
        {value || '…'}
      </code>
      <button
        type="button"
        onClick={() => {
          if (!value) return;
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
