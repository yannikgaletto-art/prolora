'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { AppLocale, Connection, PlatformType } from '@prolora/shared';
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
import { ConnectChannelPanel } from '@/app/components/ConnectChannelPanel';
import type { ConnectionListItem } from '@/lib/connections/list-connections';
import {
  CONNECTION_REGISTRY,
  getConnectorDescriptor,
  groupConnectorsByAvailability,
  type ConnectorAvailability,
  type OAuthAppStatusDto,
  type PlatformConnectorDescriptor,
} from '@/lib/connections/registry';
import type { ChannelCapacity } from '@/lib/connections/capacity';
import type { ConnectionHealth, ConnectionHealthState } from '@/lib/connections/health';
import { getRun7Dict, type Run7Dict } from '@/lib/i18n/run7';

// Platforms that authenticate via an OAuth consent screen. GOAL-RUN6 Phase 0:
// the initiate step is a fetchApi JSON round-trip (startOAuthConnect) so
// pre-consent errors render inline; only the consent hop itself navigates.
// Mastodon is OAuth too, but needs an instance first, so it gets its own step.
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
  const meta = getConnectorDescriptor(platform) ?? { color: '#64748B', initial: platform.slice(0, 2).toUpperCase() };
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

// The four registry categories are four different promises, so they get four
// different sections rather than one alphabetised list where "coming soon"
// looks like a button that failed.
const AVAILABILITY_TONE: Record<ConnectorAvailability, 'green' | 'amber' | 'gray'> = {
  available: 'green',
  oauth_byo: 'amber',
  manual_assist: 'gray',
  coming_soon: 'gray',
};

function availabilityLabel(
  availability: ConnectorAvailability,
  strings: Run7Dict['connections']
): string {
  if (availability === 'available') return strings.available;
  if (availability === 'oauth_byo') return strings.setupNeeded;
  if (availability === 'coming_soon') return strings.comingSoon;
  return strings.manualAssist;
}

const CATEGORY_HEADINGS: Record<ConnectorAvailability, { title: string; blurb: string }> = {
  available: { title: 'Ready to connect', blurb: 'One sign-in and Prolora can publish.' },
  oauth_byo: {
    title: 'Bring your own app',
    blurb: 'These platforms issue credentials per developer account — about two minutes of setup.',
  },
  manual_assist: {
    title: 'Manual assist',
    blurb: 'No usable posting API. Prolora prepares the copy and opens the page.',
  },
  coming_soon: { title: 'Not available yet', blurb: 'Waiting on provider access. Nothing to do here.' },
};

// Traffic light: one glyph, one meaning, everywhere on the page.
const HEALTH_DOT: Record<ConnectionHealthState, { color: string; label: string }> = {
  healthy: { color: 'bg-green-500', label: 'Healthy' },
  expiring_soon: { color: 'bg-amber-500', label: 'Expiring soon' },
  expired: { color: 'bg-red-500', label: 'Expired' },
  revoked: { color: 'bg-red-500', label: 'Revoked' },
};

function HealthDot({ state }: { state: ConnectionHealthState }) {
  const meta = HEALTH_DOT[state];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${meta.color}`} />
      <span className="text-xs text-gray-600">{meta.label}</span>
    </span>
  );
}

function capacityLabel(capacity: ChannelCapacity | undefined): string {
  if (!capacity) return '—';
  if (capacity.blocked) return '0';
  return capacity.remainingToday === null ? '∞' : String(capacity.remainingToday);
}

function PickerRow({
  connector,
  onSelect,
  pending,
  strings,
}: {
  connector: PlatformConnectorDescriptor;
  onSelect: (connector: PlatformConnectorDescriptor) => void;
  pending: boolean;
  strings: Run7Dict['connections'];
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
      onClick={() => onSelect(connector)}
      disabled={pending}
    >
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: connector.color }}>{connector.initial}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{connector.label}</span>
        <span className="block truncate text-xs text-gray-500">{connector.description}</span>
      </span>
      <Badge tone={AVAILABILITY_TONE[connector.availability]}>
        {availabilityLabel(connector.availability, strings)}
      </Badge>
      {pending && <span className="ml-auto text-xs text-gray-400">{strings.opening}</span>}
    </button>
  );
}

export interface ConnectionsViewProps {
  initialConnections: ConnectionListItem[];
  health: ConnectionHealth[];
  capacity: ChannelCapacity[];
  oauthApps: Record<'linkedin' | 'x', OAuthAppStatusDto>;
  locale: AppLocale;
}

export function ConnectionsView({
  initialConnections,
  health,
  capacity,
  oauthApps,
  locale,
}: ConnectionsViewProps) {
  const strings = getRun7Dict(locale).connections;
  const router = useRouter();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [appStatuses, setAppStatuses] = useState(oauthApps);
  const [byoPlatform, setByoPlatform] = useState<'linkedin' | 'x' | null>(null);

  const healthById = new Map(health.map((item) => [item.connectionId, item]));
  const capacityById = new Map(capacity.map((item) => [item.connectionId, item]));

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
  const [credentialConnector, setCredentialConnector] = useState<PlatformConnectorDescriptor | null>(null);
  const [simpleCredential, setSimpleCredential] = useState('');
  const [credentialFields, setCredentialFields] = useState<Record<string, string>>({});
  const [simpleSubmitting, setSimpleSubmitting] = useState(false);
  const [simpleError, setSimpleError] = useState<string | null>(null);
  const [pickerInfo, setPickerInfo] = useState<{ title: string; description: string; deepLink?: string } | null>(null);

  function openConnect(connector: PlatformConnectorDescriptor) {
    setPickerInfo(null);
    const platform = connector.id;
    // BYO-OAuth: an already-stored app skips straight to the consent screen;
    // otherwise the panel collects it first. Either way the user never hits a
    // message about someone else having to act.
    if (connector.connectFlow === 'oauth_byo' && (platform === 'linkedin' || platform === 'x')) {
      if (appStatuses[platform].connected) {
        void handleOAuthConnect(platform);
        return;
      }
      setPickerOpen(false);
      setPickerError(null);
      setByoPlatform(platform);
      return;
    }
    if (connector.connectFlow === 'info') {
      setPickerInfo({ title: connector.label, description: connector.description, deepLink: connector.deepLink });
      return;
    }
    if (connector.connectFlow === 'oauth') {
      // Stay in the picker: on success the browser navigates to the consent
      // screen; on failure the error renders right here instead of a JSON page.
      void handleOAuthConnect(platform as OAuthPlatform);
      return;
    }
    setPickerOpen(false);
    setPickerError(null);
    if (connector.connectFlow === 'mastodon') {
      setMastodonInstance('');
      setMastodonError(null);
      setMastodonOpen(true);
    } else if (connector.connectFlow === 'bluesky') {
      setCredentialModal('bluesky');
    } else if (connector.connectFlow === 'telegram') {
      setCredentialModal('telegram');
    } else if (connector.connectFlow === 'credential') {
      setCredentialConnector(connector);
      setSimpleCredential('');
      setCredentialFields({});
      setSimpleError(null);
    }
  }

  async function handleSimpleCredentialSubmit(event: FormEvent) {
    event.preventDefault();
    if (!credentialConnector) return;
    setSimpleSubmitting(true);
    setSimpleError(null);
    try {
      const result = await fetchApi<ConnectResponse>('/v1/connections/credential', {
        method: 'POST',
        body: JSON.stringify({ platform: credentialConnector.id, credential: simpleCredential, ...credentialFields }),
      });
      setCredentialConnector(null);
      setToast({ variant: 'success', message: `${strings.connected}: ${result.connection.account_name} · ${credentialConnector.label}.` });
      router.refresh();
    } catch (error) {
      setSimpleError(errorMessage(error));
    } finally {
      setSimpleSubmitting(false);
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
      // The same handler serves the card's Reconnect button, where the picker
      // is closed and an inline error would be invisible.
      if (!pickerOpen) setToast({ variant: 'error', message: errorMessage(error) });
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

  // Reconnect reuses the connect flow rather than a second code path: a
  // reconnect that skipped the BYO step would 503 for a workspace whose stored
  // app was removed in the meantime.
  function reconnect(connection: ConnectionListItem) {
    const connector = CONNECTION_REGISTRY.find((item) => item.id === connection.platform);
    if (connector) openConnect(connector);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setPickerOpen(true)}>Connect New</Button>
      </div>

      {/* Capacity is a planning number, so it belongs above the fold rather than
          inside a card the user has to open. Blocked channels stay listed at 0
          instead of disappearing — a missing row reads as "no problem". */}
      {capacity.length > 0 && (
        <Card
          title="Today's capacity"
          description="What each channel can still take before its daily cap or rate-limit window resets."
        >
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {capacity.map((item) => {
              const connection = initialConnections.find(
                (candidate) => candidate.connection_id === item.connectionId
              );
              return (
                <li key={item.connectionId} className="flex items-baseline gap-2">
                  <span className="text-sm text-gray-600">
                    {connection?.account_name ?? getConnectorDescriptor(item.platform)?.label ?? item.platform}
                  </span>
                  <span
                    className={`text-sm font-semibold ${item.blocked ? 'text-red-600' : 'text-gray-900'}`}
                  >
                    {capacityLabel(item)}
                  </span>
                  {item.blocked && (
                    <span className="text-xs text-red-600">
                      {item.blockedReason === 'rate_limited'
                        ? 'rate limited'
                        : item.blockedReason === 'revoked'
                          ? 'revoked'
                          : 'token expired'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {initialConnections.length === 0 ? (
        <EmptyState
          title="No accounts connected yet"
          description="Connect LinkedIn, X, Bluesky, Mastodon or Telegram to publish and listen from Prolora."
          action={<Button onClick={() => setPickerOpen(true)}>Connect New</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialConnections.map((connection) => {
            const meta = getConnectorDescriptor(connection.platform);
            const isActive = connection.status === 'active';
            const state = healthById.get(connection.connection_id);
            const channelCapacity = capacityById.get(connection.connection_id);
            const daysLeft = state?.expiresInDays ?? null;
            // The whole point of the monitor: warn while reconnecting is still
            // a choice, not a recovery.
            const warnExpiring = state?.state === 'expiring_soon' && daysLeft !== null;
            return (
              <Card key={connection.connection_id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <PlatformBadge platform={connection.platform} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{connection.account_name}</p>
                      <p className="text-xs text-gray-500">{meta?.label ?? connection.platform}</p>
                    </div>
                  </div>
                  <Badge status={connection.status} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {state && <HealthDot state={state.state} />}
                  <span className="text-xs text-gray-500">
                    Today: {capacityLabel(channelCapacity)}
                  </span>
                </div>

                {warnExpiring && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs text-amber-900">
                      {daysLeft <= 0
                        ? 'Token expires today.'
                        : `Token expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`}{' '}
                      {state?.canAutoRefresh
                        ? 'Prolora will try to refresh it automatically.'
                        : 'Reconnect to keep publishing.'}
                    </p>
                    <Button
                      className="mt-2"
                      variant="secondary"
                      size="sm"
                      loading={oauthPending === connection.platform}
                      onClick={() => reconnect(connection)}
                    >
                      Reconnect now
                    </Button>
                  </div>
                )}

                <p className="mt-3 text-xs text-gray-500">
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
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={oauthPending === connection.platform}
                      onClick={() => reconnect(connection)}
                    >
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
        <div className="space-y-5">
          {groupConnectorsByAvailability().map((group) => (
            <section key={group.availability}>
              <h3 className="text-xs font-semibold tracking-wide text-gray-900 uppercase">
                {CATEGORY_HEADINGS[group.availability].title}
              </h3>
              <p className="mt-0.5 mb-2 text-xs text-gray-500">
                {CATEGORY_HEADINGS[group.availability].blurb}
              </p>
              <div className="space-y-2">
                {group.connectors.map((connector) => (
                  <PickerRow
                    key={connector.id}
                    connector={connector}
                    onSelect={openConnect}
                    pending={oauthPending === connector.id}
                    strings={strings}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        {pickerError && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
            <p className="text-sm text-red-600">{pickerError.message}</p>
            {pickerError.hint && <p className="mt-1 text-xs text-red-500">{pickerError.hint}</p>}
          </div>
        )}
        {pickerInfo && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-medium">{pickerInfo.title}</p>
            <p className="mt-1">{pickerInfo.description}</p>
            {pickerInfo.deepLink && (
              <a href={pickerInfo.deepLink} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium underline">{strings.openPublishingPage}</a>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={credentialConnector !== null}
        onClose={() => setCredentialConnector(null)}
        title={`Connect ${credentialConnector?.label ?? ''}`}
        description={credentialConnector?.credentialForm?.description}
      >
        <form onSubmit={handleSimpleCredentialSubmit} className="space-y-4">
          <Input
            label={credentialConnector?.credentialForm?.secretLabel ?? strings.credential}
            type="password"
            value={simpleCredential}
            onChange={(event) => setSimpleCredential(event.target.value)}
            required
          />
          {credentialConnector?.credentialForm?.fields?.map((field) => (
            <Input key={field.key} label={field.label} value={credentialFields[field.key] ?? ''} onChange={(event) => setCredentialFields((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} required />
          ))}
          {simpleError && <p className="text-sm text-red-600" role="alert">{simpleError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={simpleSubmitting} onClick={() => setCredentialConnector(null)}>{strings.cancel}</Button>
            <Button type="submit" loading={simpleSubmitting}>{strings.connect}</Button>
          </div>
        </form>
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

      {/* BYO-OAuth: store the workspace's own app, then hand off to consent. */}
      <Modal
        open={byoPlatform !== null}
        onClose={() => setByoPlatform(null)}
        title={byoPlatform ? `Connect ${appStatuses[byoPlatform].label}` : ''}
        description="Prolora publishes through your own developer app."
      >
        {byoPlatform && (
          <ConnectChannelPanel
            embedded
            platform={byoPlatform}
            label={appStatuses[byoPlatform].label}
            descriptor={getConnectorDescriptor(byoPlatform)!.oauthApp!}
            status={appStatuses[byoPlatform]}
            onStatusChange={(next) => {
              setAppStatuses((current) => ({ ...current, [next.platform]: next }));
              router.refresh();
            }}
          />
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
