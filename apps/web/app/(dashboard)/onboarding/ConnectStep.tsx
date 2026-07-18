'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { Connection, PlatformType } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Input } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import {
  startOAuthConnect,
  normalizeInstanceInput,
  connectErrorHint,
  type OAuthPlatform,
} from '@/app/lib/connect';
import type { ConnectionListItem } from '@/lib/connections/list-connections';

// Trimmed re-implementation of the platform-connect patterns from F4's
// ConnectionsView (app/(dashboard)/connections/ConnectionsView.tsx) — same
// split: LinkedIn/X/Mastodon are OAuth (GOAL-RUN6 Phase 0: initiated via a
// fetchApi JSON round-trip so pre-consent errors render inline; only the
// consent hop navigates), Bluesky/Telegram are credential forms posted via
// fetchApi. No new connect flow is invented here.
const OAUTH_REDIRECT_PLATFORMS: PlatformType[] = ['linkedin', 'x'];

const PLATFORM_META: Record<PlatformType, { label: string; initial: string; color: string }> = {
  linkedin: { label: 'LinkedIn', initial: 'in', color: '#0A66C2' },
  x: { label: 'X', initial: 'X', color: '#000000' },
  bluesky: { label: 'Bluesky', initial: 'B', color: '#1185FE' },
  mastodon: { label: 'Mastodon', initial: 'M', color: '#6364FF' },
  telegram: { label: 'Telegram', initial: 'T', color: '#26A5E4' },
  discord: { label: 'Discord', initial: 'D', color: '#5865F2' },
  devto: { label: 'Dev.to', initial: 'DEV', color: '#0A0A0A' },
  hashnode: { label: 'Hashnode', initial: 'H', color: '#2962FF' },
};

const ALL_PLATFORMS: PlatformType[] = ['linkedin', 'x', 'bluesky', 'mastodon', 'telegram'];

interface AvailableChat {
  chat_id: string;
  title: string;
  type: string;
}

interface ConnectResponse {
  connection: Connection;
}

interface TelegramStepResponse {
  requires_chat_selection: true;
  available_chats: AvailableChat[];
}

export function ConnectStep({ connections }: { connections: ConnectionListItem[] }) {
  const router = useRouter();
  const hasConnection = connections.length > 0;
  const connectedPlatforms = new Set(connections.map((c) => c.platform));

  const [mastodonOpen, setMastodonOpen] = useState(false);
  const [mastodonInstance, setMastodonInstance] = useState('');
  const [mastodonError, setMastodonError] = useState<{ message: string; hint: string | null } | null>(null);
  const [mastodonSubmitting, setMastodonSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState<OAuthPlatform | null>(null);
  const [oauthError, setOauthError] = useState<{ message: string; hint: string | null } | null>(null);
  const [credentialModal, setCredentialModal] = useState<'bluesky' | 'telegram' | null>(null);

  const [blueskyHandle, setBlueskyHandle] = useState('');
  const [blueskyPassword, setBlueskyPassword] = useState('');
  const [blueskySubmitting, setBlueskySubmitting] = useState(false);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);

  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChats, setTelegramChats] = useState<AvailableChat[] | null>(null);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSubmitting, setTelegramSubmitting] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  function closeBlueskyModal() {
    setCredentialModal(null);
    setBlueskyHandle('');
    setBlueskyPassword('');
    setBlueskyError(null);
  }

  function closeTelegramModal() {
    setCredentialModal(null);
    setTelegramToken('');
    setTelegramChats(null);
    setTelegramChatId('');
    setTelegramError(null);
  }

  async function handleBlueskySubmit(event: FormEvent) {
    event.preventDefault();
    setBlueskySubmitting(true);
    setBlueskyError(null);
    try {
      await fetchApi<ConnectResponse>('/auth/bluesky', {
        method: 'POST',
        body: JSON.stringify({ handle: blueskyHandle, app_password: blueskyPassword }),
      });
      closeBlueskyModal();
      router.refresh();
    } catch (error) {
      setBlueskyError(errorMessage(error));
    } finally {
      setBlueskySubmitting(false);
    }
  }

  async function handleTelegramTokenSubmit(event: FormEvent) {
    event.preventDefault();
    setTelegramSubmitting(true);
    setTelegramError(null);
    try {
      const result = await fetchApi<ConnectResponse | TelegramStepResponse>('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ bot_token: telegramToken }),
      });
      if ('requires_chat_selection' in result) {
        setTelegramChats(result.available_chats);
      } else {
        closeTelegramModal();
        router.refresh();
      }
    } catch (error) {
      setTelegramError(errorMessage(error));
    } finally {
      setTelegramSubmitting(false);
    }
  }

  async function handleTelegramChatSubmit(event: FormEvent) {
    event.preventDefault();
    if (!telegramChatId) {
      setTelegramError('Choose a chat to continue.');
      return;
    }
    setTelegramSubmitting(true);
    setTelegramError(null);
    try {
      const result = await fetchApi<ConnectResponse | TelegramStepResponse>('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ bot_token: telegramToken, chat_id: telegramChatId }),
      });
      if ('requires_chat_selection' in result) {
        setTelegramChats(result.available_chats);
        setTelegramError('That chat is no longer available. Pick another.');
      } else {
        closeTelegramModal();
        router.refresh();
      }
    } catch (error) {
      setTelegramError(errorMessage(error));
    } finally {
      setTelegramSubmitting(false);
    }
  }

  function openConnect(platform: PlatformType) {
    if (OAUTH_REDIRECT_PLATFORMS.includes(platform)) {
      void handleOAuthConnect(platform as OAuthPlatform);
      return;
    }
    if (platform === 'mastodon') {
      setMastodonInstance('');
      setMastodonError(null);
      setMastodonOpen(true);
    } else if (platform === 'bluesky' || platform === 'telegram') {
      setCredentialModal(platform);
    }
  }

  async function handleOAuthConnect(platform: OAuthPlatform) {
    setOauthPending(platform);
    setOauthError(null);
    try {
      await startOAuthConnect(platform);
      // No cleanup: the browser is already navigating to the consent screen.
    } catch (error) {
      setOauthError({ message: errorMessage(error), hint: connectErrorHint(error) });
      setOauthPending(null);
    }
  }

  async function handleMastodonSubmit(event: FormEvent) {
    event.preventDefault();
    const instance = normalizeInstanceInput(mastodonInstance);
    if (!instance) {
      setMastodonError({
        message: 'That does not look like a Mastodon server.',
        hint: 'Enter just the domain of your server, e.g. mastodon.social',
      });
      return;
    }
    setMastodonSubmitting(true);
    setMastodonError(null);
    try {
      await startOAuthConnect('mastodon', { instance });
    } catch (error) {
      setMastodonError({ message: errorMessage(error), hint: connectErrorHint(error) });
      setMastodonSubmitting(false);
    }
  }

  return (
    <div>
      <div className="space-y-2">
        {ALL_PLATFORMS.map((platform) => {
          const meta = PLATFORM_META[platform];
          const isConnected = connectedPlatforms.has(platform);
          const isPending = oauthPending === platform;
          const rowClass =
            'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left ' +
            (isConnected
              ? 'border-green-200 bg-green-50'
              : 'border-gray-200 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60');

          const content = (
            <>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: meta.color }}
              >
                {meta.initial}
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">{meta.label}</span>
              {isConnected ? (
                <span className="shrink-0 text-xs font-semibold text-green-700">Connected</span>
              ) : (
                <span className="shrink-0 text-xs font-medium text-primary-700">
                  {isPending ? 'Opening…' : 'Connect'}
                </span>
              )}
            </>
          );

          if (isConnected) {
            return (
              <div key={platform} className={rowClass}>
                {content}
              </div>
            );
          }

          return (
            <button
              key={platform}
              type="button"
              className={rowClass}
              onClick={() => openConnect(platform)}
              disabled={isPending}
            >
              {content}
            </button>
          );
        })}
      </div>

      {oauthError && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
          <p className="text-sm text-red-600">{oauthError.message}</p>
          {oauthError.hint && <p className="mt-1 text-xs text-red-500">{oauthError.hint}</p>}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {hasConnection ? 'At least one account connected.' : 'Connect at least one account to continue.'}
        </p>
        {hasConnection ? (
          <Link
            href="/onboarding?step=3"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Continue
          </Link>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-md bg-primary-300 px-3 py-2 text-sm font-semibold text-white">
            Continue
          </span>
        )}
      </div>

      {/* Mastodon: needs an instance domain before the OAuth redirect can be built.
          Validated client-side, then startOAuthConnect fetches the consent URL —
          server errors render inline here instead of as a raw JSON page. */}
      <Modal
        open={mastodonOpen}
        onClose={() => setMastodonOpen(false)}
        title="Connect Mastodon"
        description="Enter your Mastodon instance to continue to sign-in."
      >
        <form onSubmit={handleMastodonSubmit} className="space-y-4">
          <Input
            label="Instance"
            name="instance"
            placeholder="mastodon.social"
            value={mastodonInstance}
            onChange={(event) => setMastodonInstance(event.target.value)}
            required
            hint="The domain of your Mastodon server."
          />
          {mastodonError && (
            <div className="rounded-md bg-red-50 px-3 py-2">
              <p className="text-sm text-red-600">{mastodonError.message}</p>
              {mastodonError.hint && <p className="mt-1 text-xs text-red-500">{mastodonError.hint}</p>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMastodonOpen(false)}
              disabled={mastodonSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={mastodonSubmitting}>
              Continue
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bluesky: no OAuth — handle + app password, verified server-side. */}
      <Modal
        open={credentialModal === 'bluesky'}
        onClose={closeBlueskyModal}
        title="Connect Bluesky"
        description="Use an app password, not your account password."
      >
        <form onSubmit={handleBlueskySubmit} className="space-y-4">
          <Input
            label="Handle"
            placeholder="you.bsky.social"
            value={blueskyHandle}
            onChange={(event) => setBlueskyHandle(event.target.value)}
            required
          />
          <Input
            label="App password"
            type="password"
            value={blueskyPassword}
            onChange={(event) => setBlueskyPassword(event.target.value)}
            hint="Create one at bsky.app -> Settings -> App passwords."
            required
          />
          {blueskyError && <p className="text-sm text-red-600">{blueskyError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeBlueskyModal} disabled={blueskySubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={blueskySubmitting}>
              Connect
            </Button>
          </div>
        </form>
      </Modal>

      {/* Telegram: bot token, then a chat picker once the token is validated. */}
      <Modal
        open={credentialModal === 'telegram'}
        onClose={closeTelegramModal}
        title="Connect Telegram"
        description={
          telegramChats ? 'Choose the chat this bot should post to.' : 'Paste the bot token from @BotFather.'
        }
      >
        {!telegramChats ? (
          <form onSubmit={handleTelegramTokenSubmit} className="space-y-4">
            <Input
              label="Bot token"
              value={telegramToken}
              onChange={(event) => setTelegramToken(event.target.value)}
              placeholder="123456789:AA..."
              required
            />
            {telegramError && <p className="text-sm text-red-600">{telegramError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeTelegramModal} disabled={telegramSubmitting}>
                Cancel
              </Button>
              <Button type="submit" loading={telegramSubmitting}>
                Continue
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleTelegramChatSubmit} className="space-y-4">
            {telegramChats.length === 0 ? (
              <p className="text-sm text-gray-500">
                No chats found yet. Add the bot to a channel or group, then try again.
              </p>
            ) : (
              <div className="space-y-2">
                {telegramChats.map((chat) => (
                  <label
                    key={chat.chat_id}
                    className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2.5 hover:bg-gray-50"
                  >
                    <input
                      type="radio"
                      name="chat_id"
                      value={chat.chat_id}
                      checked={telegramChatId === chat.chat_id}
                      onChange={() => setTelegramChatId(chat.chat_id)}
                      className="h-4 w-4 text-primary-600"
                    />
                    <span className="text-sm text-gray-900">{chat.title}</span>
                    <span className="text-xs text-gray-400">{chat.type}</span>
                  </label>
                ))}
              </div>
            )}
            {telegramError && <p className="text-sm text-red-600">{telegramError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeTelegramModal} disabled={telegramSubmitting}>
                Cancel
              </Button>
              <Button type="submit" loading={telegramSubmitting} disabled={telegramChats.length === 0}>
                Connect
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
