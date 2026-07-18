'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { Connection, PlatformType } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Badge } from '@/app/components/Badge';
import { Modal } from '@/app/components/Modal';
import { Input } from '@/app/components/Input';
import { EmptyState } from '@/app/components/EmptyState';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import {
  startOAuthConnect,
  normalizeInstanceInput,
  connectErrorHint,
  type OAuthPlatform,
} from '@/app/lib/connect';
import type { ConnectionListItem } from '@/lib/connections/list-connections';

// Platforms that authenticate via an OAuth consent screen. GOAL-RUN6 Phase 0:
// the initiate step is a fetchApi JSON round-trip (startOAuthConnect) so
// pre-consent errors render inline; only the consent hop itself navigates.
// Mastodon is OAuth too, but needs an instance first, so it gets its own step.
const OAUTH_REDIRECT_PLATFORMS: PlatformType[] = ['linkedin', 'x'];

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

const lastUsedFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// Absolute timestamps rather than "3 days ago": relative time is computed
// from Date.now(), which differs between the server render and client
// hydration and would produce a hydration mismatch warning for no real
// benefit here.
function formatLastUsed(value: string | null): string {
  if (!value) return 'Never used';
  return lastUsedFormatter.format(new Date(value));
}

function PlatformBadge({ platform, size = 10 }: { platform: PlatformType; size?: number }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: meta.color, height: size * 4, width: size * 4, fontSize: size * 1.4 }}
    >
      {meta.initial}
    </span>
  );
}

function PickerRow({
  platform,
  onSelect,
  pending,
}: {
  platform: PlatformType;
  onSelect: (platform: PlatformType) => void;
  pending: boolean;
}) {
  const meta = PLATFORM_META[platform];
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
      onClick={() => onSelect(platform)}
      disabled={pending}
    >
      <PlatformBadge platform={platform} size={9} />
      <span className="text-sm font-medium text-gray-900">{meta.label}</span>
      {pending && <span className="ml-auto text-xs text-gray-400">Opening…</span>}
    </button>
  );
}

export function ConnectionsView({ initialConnections }: { initialConnections: ConnectionListItem[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<{ message: string; hint: string | null } | null>(null);
  const [oauthPending, setOauthPending] = useState<OAuthPlatform | null>(null);
  const [mastodonOpen, setMastodonOpen] = useState(false);
  const [mastodonInstance, setMastodonInstance] = useState('');
  const [mastodonError, setMastodonError] = useState<{ message: string; hint: string | null } | null>(null);
  const [mastodonSubmitting, setMastodonSubmitting] = useState(false);
  const [credentialModal, setCredentialModal] = useState<'bluesky' | 'telegram' | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionListItem | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Bluesky form state.
  const [blueskyHandle, setBlueskyHandle] = useState('');
  const [blueskyPassword, setBlueskyPassword] = useState('');
  const [blueskySubmitting, setBlueskySubmitting] = useState(false);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);

  // Telegram form state (two steps: token -> chat picker).
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChats, setTelegramChats] = useState<AvailableChat[] | null>(null);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSubmitting, setTelegramSubmitting] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  function openConnect(platform: PlatformType) {
    if (OAUTH_REDIRECT_PLATFORMS.includes(platform)) {
      // Stay in the picker: on success the browser navigates to the consent
      // screen; on failure the error renders right here instead of a JSON page.
      void handleOAuthConnect(platform as OAuthPlatform);
      return;
    }
    setPickerOpen(false);
    setPickerError(null);
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
    setPickerError(null);
    try {
      await startOAuthConnect(platform);
      // No cleanup: window.location.assign is already navigating away.
    } catch (error) {
      setPickerError({ message: errorMessage(error), hint: connectErrorHint(error) });
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
      setToast({ variant: 'success', message: `Connected @${blueskyHandle.replace(/^@/, '')} on Bluesky.` });
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
        setToast({ variant: 'success', message: `Connected ${result.connection.account_name} on Telegram.` });
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
        setToast({ variant: 'success', message: `Connected ${result.connection.account_name} on Telegram.` });
        router.refresh();
      }
    } catch (error) {
      setTelegramError(errorMessage(error));
    } finally {
      setTelegramSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      await fetchApi(`/v1/connections/${disconnectTarget.connection_id}`, { method: 'DELETE' });
      setToast({ variant: 'success', message: `Disconnected ${disconnectTarget.account_name}.` });
      setDisconnectTarget(null);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setPickerOpen(true)}>Connect New</Button>
      </div>

      {initialConnections.length === 0 ? (
        <EmptyState
          title="No accounts connected yet"
          description="Connect LinkedIn, X, Bluesky, Mastodon or Telegram to publish and listen from Prolora."
          action={<Button onClick={() => setPickerOpen(true)}>Connect New</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialConnections.map((connection) => {
            const meta = PLATFORM_META[connection.platform];
            const isActive = connection.status === 'active';
            return (
              <Card key={connection.connection_id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <PlatformBadge platform={connection.platform} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{connection.account_name}</p>
                      <p className="text-xs text-gray-500">{meta.label}</p>
                    </div>
                  </div>
                  <Badge status={connection.status} />
                </div>

                <p className="mt-4 text-xs text-gray-500">
                  Last used: {formatLastUsed(connection.last_used_at)}
                </p>

                <div className="mt-4 flex items-center gap-2">
                  {isActive ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDisconnectTarget(connection)}
                    >
                      Disconnect
                    </Button>
                  ) : OAUTH_REDIRECT_PLATFORMS.includes(connection.platform) ? (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={oauthPending === connection.platform}
                      onClick={async () => {
                        try {
                          setOauthPending(connection.platform as OAuthPlatform);
                          await startOAuthConnect(connection.platform as OAuthPlatform);
                        } catch (error) {
                          setToast({ variant: 'error', message: errorMessage(error) });
                          setOauthPending(null);
                        }
                      }}
                    >
                      Reconnect
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => openConnect(connection.platform)}>
                      Reconnect
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Platform picker */}
      <Modal
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setPickerError(null);
        }}
        title="Connect a new account"
        description="Choose a platform to connect to this workspace."
      >
        <div className="space-y-2">
          {ALL_PLATFORMS.map((platform) => (
            <PickerRow
              key={platform}
              platform={platform}
              onSelect={openConnect}
              pending={oauthPending === platform}
            />
          ))}
        </div>
        {pickerError && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
            <p className="text-sm text-red-600">{pickerError.message}</p>
            {pickerError.hint && <p className="mt-1 text-xs text-red-500">{pickerError.hint}</p>}
          </div>
        )}
      </Modal>

      {/* Mastodon: needs an instance domain before the OAuth redirect can be built.
          The instance is validated client-side, then startOAuthConnect fetches the
          consent URL — server errors (invalid_instance, platform_unreachable)
          render inline here instead of as a raw JSON page. */}
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
          telegramChats
            ? 'Choose the chat this bot should post to.'
            : 'Paste the bot token from @BotFather.'
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

      {/* Disconnect confirmation */}
      <Modal
        open={disconnectTarget !== null}
        onClose={() => setDisconnectTarget(null)}
        title="Disconnect account"
        description={
          disconnectTarget
            ? `Prolora will stop publishing to ${disconnectTarget.account_name}. You can reconnect later.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisconnectTarget(null)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDisconnect} loading={disconnecting}>
              Disconnect
            </Button>
          </>
        }
      />

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
