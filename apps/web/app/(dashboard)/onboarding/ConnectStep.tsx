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
import type { ConnectionListItem } from '@/lib/connections/list-connections';

// Trimmed re-implementation of the platform-connect patterns from F4's
// ConnectionsView (app/(dashboard)/connections/ConnectionsView.tsx) — same
// truthful split: LinkedIn/X/Mastodon are full-page OAuth redirects to
// GET /api/auth/:platform, Bluesky/Telegram are credential forms posted via
// fetchApi. No new connect flow is invented here.
const REDIRECT_PLATFORMS: PlatformType[] = ['linkedin', 'x'];

const PLATFORM_META: Record<PlatformType, { label: string; initial: string; color: string }> = {
  linkedin: { label: 'LinkedIn', initial: 'in', color: '#0A66C2' },
  x: { label: 'X', initial: 'X', color: '#000000' },
  bluesky: { label: 'Bluesky', initial: 'B', color: '#1185FE' },
  mastodon: { label: 'Mastodon', initial: 'M', color: '#6364FF' },
  telegram: { label: 'Telegram', initial: 'T', color: '#26A5E4' },
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
    if (platform === 'mastodon') setMastodonOpen(true);
    else if (platform === 'bluesky' || platform === 'telegram') setCredentialModal(platform);
  }

  return (
    <div>
      <div className="space-y-2">
        {ALL_PLATFORMS.map((platform) => {
          const meta = PLATFORM_META[platform];
          const isConnected = connectedPlatforms.has(platform);
          const isRedirect = REDIRECT_PLATFORMS.includes(platform);
          const rowClass =
            'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left ' +
            (isConnected ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:bg-gray-50');

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
                <span className="shrink-0 text-xs font-medium text-primary-700">Connect</span>
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

          if (isRedirect) {
            return (
              <a key={platform} href={`/api/auth/${platform}`} className={rowClass}>
                {content}
              </a>
            );
          }

          return (
            <button key={platform} type="button" className={rowClass} onClick={() => openConnect(platform)}>
              {content}
            </button>
          );
        })}
      </div>

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

      {/* Mastodon: needs an instance domain before the OAuth redirect can be built. */}
      <Modal
        open={mastodonOpen}
        onClose={() => setMastodonOpen(false)}
        title="Connect Mastodon"
        description="Enter your Mastodon instance to continue to sign-in."
      >
        <form method="GET" action="/api/auth/mastodon" className="space-y-4">
          <Input
            label="Instance"
            name="instance"
            placeholder="mastodon.social"
            required
            hint="The domain of your Mastodon server."
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMastodonOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Continue</Button>
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
