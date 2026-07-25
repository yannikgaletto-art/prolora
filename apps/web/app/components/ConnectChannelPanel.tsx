'use client';

// The self-service replacement for "Operator OAuth setup required" on LinkedIn
// and X.
//
// Deliberately not shared with ConnectRedditPanel: that one is paste-and-verify
// and ends the moment the server confirms the pair. This is a three-act state
// machine — store the app credentials, hand the browser to the provider's
// consent screen, come back with a token — and the middle act is a full-page
// navigation, so the component has to survive being unmounted and re-entered
// with the app already stored. The visual language (numbered steps, copy field
// for the redirect URI, verification banner) is shared; the logic is not.
//
// The secret is written to PUT /api/v1/connections/oauth-app/{platform}, stored
// AES-256-GCM encrypted server-side, and cleared from component state as soon
// as the request returns.

import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './Button';
import { Input } from './Input';
import { stepTransition } from './motion';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { startOAuthConnect } from '@/app/lib/connect';
import type { OAuthAppDescriptor, OAuthAppStatusDto } from '@/lib/connections/registry';

interface Props {
  platform: 'linkedin' | 'x';
  label: string;
  descriptor: OAuthAppDescriptor;
  status: OAuthAppStatusDto;
  onStatusChange: (status: OAuthAppStatusDto) => void;
  /** Rendered inside a modal — drop the outer card chrome. */
  embedded?: boolean;
}

export function ConnectChannelPanel({
  platform,
  label,
  descriptor,
  status,
  onStatusChange,
  embedded = false,
}: Props) {
  const reduced = useReducedMotion();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!status.connected);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await fetchApi<OAuthAppStatusDto>(`/v1/connections/oauth-app/${platform}`, {
        method: 'PUT',
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
      });
      setClientSecret('');
      setClientId('');
      setShowForm(false);
      onStatusChange(next);
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
      const next = await fetchApi<OAuthAppStatusDto>(`/v1/connections/oauth-app/${platform}`, {
        method: 'DELETE',
      });
      setShowForm(true);
      onStatusChange(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleAuthorize() {
    setRedirecting(true);
    setError(null);
    try {
      await startOAuthConnect(platform);
      // No cleanup: the browser is already navigating to the consent screen.
    } catch (caught) {
      setError(errorMessage(caught));
      setRedirecting(false);
    }
  }

  const wrapper = embedded ? '' : 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';

  if (status.connected && !showForm) {
    return (
      <motion.div {...stepTransition(reduced)} className={wrapper}>
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-900">{label} app stored</p>
          <p className="mt-0.5 text-xs text-green-800">
            {status.source === 'environment'
              ? 'Using the server-configured app.'
              : status.clientIdHint
                ? `App ${status.clientIdHint.slice(0, 8)}… · ready to authorize`
                : 'Ready to authorize.'}
          </p>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          Last step: sign in at {label} and grant Prolora access to the account you want to publish
          from.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" loading={redirecting} onClick={handleAuthorize}>
            {redirecting ? `Opening ${label}…` : `Continue to ${label}`}
          </Button>
          {status.source === 'workspace' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
                Replace app
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDisconnect} loading={saving}>
                Remove
              </Button>
            </>
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
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-900">Connect {label} — about two minutes</p>
        <p className="mt-1 text-xs text-gray-500">
          {label} issues app credentials per developer account, so Prolora publishes through
          <span> your</span> app — not a shared one. Nothing about your account is shared with other
          workspaces.
        </p>
        <ol className="mt-3 space-y-2.5 text-sm text-gray-600">
          <li className="flex gap-2.5">
            <StepDot>1</StepDot>
            <span>
              Create an app at{' '}
              <a
                href={descriptor.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800"
              >
                {descriptor.consoleLabel}
              </a>
              .
            </span>
          </li>
          <li className="flex gap-2.5">
            <StepDot>2</StepDot>
            <span>
              Register this exact callback URL in the app:
              <CopyField value={status.redirect_uri} />
              <span className="mt-1 block text-xs text-gray-500">
                It must match character for character, otherwise {label} refuses the sign-in.
              </span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <StepDot>3</StepDot>
            <span>
              Request these scopes:{' '}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-xs text-gray-700 ring-1 ring-gray-200 ring-inset">
                {descriptor.scopes.join(' ')}
              </code>
            </span>
          </li>
          <li className="flex gap-2.5">
            <StepDot>4</StepDot>
            <span>Paste the app&rsquo;s client ID and client secret below.</span>
          </li>
        </ol>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <Input
          label="Client ID"
          name={`${platform}_client_id`}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={6}
        />
        <Input
          label="Client secret"
          name={`${platform}_client_secret`}
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={6}
          hint="Stored encrypted (AES-256-GCM). It is never shown again after saving."
        />

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
            {saving ? 'Saving…' : `Save ${label} app`}
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
