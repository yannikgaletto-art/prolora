'use client';

// The self-service replacement for "der Betreiber muss REDDIT_CLIENT_ID setzen".
// Reddit genuinely requires you to register your own app — that part cannot be
// abstracted away — so the panel does the next best thing: it walks through the
// three fields Reddit's form needs, pre-fills the redirect URI, and verifies the
// pasted pair live before storing it. Credentials go to
// PUT /api/v1/integrations/reddit and are encrypted server-side; nothing
// sensitive is kept in component state after a successful save.

import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './Button';
import { Input } from './Input';
import { stepTransition } from './motion';
import { fetchApi, errorMessage } from '@/app/lib/api';

export interface RedditIntegrationStatus {
  connected: boolean;
  source: 'workspace' | 'environment' | null;
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

const REDDIT_APP_URL = 'https://www.reddit.com/prefs/apps';

interface Props {
  status: RedditIntegrationStatus;
  onConnected: (status: RedditIntegrationStatus) => void;
  /** Rendered inside a modal — drop the outer card chrome. */
  embedded?: boolean;
}

export function ConnectRedditPanel({ status, onConnected, embedded = false }: Props) {
  const reduced = useReducedMotion();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!status.connected);

  // Reddit's form demands a redirect URI even for app-only (client_credentials)
  // access, which never redirects anywhere. The app's own origin is a real URL
  // that satisfies the field without implying a callback route that exists.
  const redirectUri = typeof window === 'undefined' ? '' : window.location.origin;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await fetchApi<RedditIntegrationStatus>('/v1/integrations/reddit', {
        method: 'PUT',
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
      });
      // Clear the secret from memory the moment it is no longer needed.
      setClientSecret('');
      setClientId('');
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
      const next = await fetchApi<RedditIntegrationStatus>('/v1/integrations/reddit', {
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

  const wrapper = embedded
    ? ''
    : 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';

  if (status.connected && !showForm) {
    return (
      <motion.div {...stepTransition(reduced)} className={wrapper}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-green-900">Reddit connected</p>
            <p className="mt-0.5 text-xs text-green-800">
              {status.source === 'environment'
                ? 'Using the server-configured Reddit app.'
                : status.clientIdHint
                  ? `App ${status.clientIdHint.slice(0, 6)}… · verified`
                  : 'Verified against Reddit.'}
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
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-900">Connect Reddit — about a minute</p>
        <ol className="mt-3 space-y-2.5 text-sm text-gray-600">
          <li className="flex gap-2.5">
            <StepDot>1</StepDot>
            <span>
              Open{' '}
              <a
                href={REDDIT_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800"
              >
                reddit.com/prefs/apps
              </a>{' '}
              and choose <strong className="font-medium text-gray-900">create another app…</strong>
            </span>
          </li>
          <li className="flex gap-2.5">
            <StepDot>2</StepDot>
            <span>
              Pick type <strong className="font-medium text-gray-900">script</strong>, give it any
              name, and paste this as the redirect URI:
              <CopyField value={redirectUri} />
              <span className="mt-1 block text-xs text-gray-500">
                Prolora only reads public Reddit data and never posts, so nothing ever redirects
                here — Reddit just requires the field to be filled.
              </span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <StepDot>3</StepDot>
            <span>
              Copy the ID under the app name and the <strong className="font-medium text-gray-900">secret</strong>{' '}
              into the fields below.
            </span>
          </li>
        </ol>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <Input
          label="Client ID"
          name="reddit_client_id"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={8}
          placeholder="e.g. Ab3dEfGh1JkLmN"
        />
        <Input
          label="Client secret"
          name="reddit_client_secret"
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={8}
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
            {saving ? 'Verifying with Reddit…' : 'Connect Reddit'}
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
