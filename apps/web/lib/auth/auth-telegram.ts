import { encrypt } from '@/lib/auth/encryption';
import { saveConnection } from '@/lib/auth/connections';
import { ApiError } from '@/lib/api/http';
import type { ConnectionRow } from '@/lib/db';

interface TelegramBot {
  id: number;
  username: string;
  first_name: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface AvailableChat {
  chat_id: string;
  title: string;
  type: string;
}

export type TelegramConnectResult =
  | { connected: true; connection: ConnectionRow }
  | { connected: false; available_chats: AvailableChat[] };

// Two-step flow: without chat_id we validate the token and return candidate
// chats (from getUpdates) for the user to pick; with chat_id we verify the
// bot is admin there and persist the connection.
export async function connectTelegram(
  workspaceId: string,
  botToken: string,
  chatId?: string
): Promise<TelegramConnectResult> {
  const token = botToken.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new ApiError(400, 'Invalid bot token format.', 'invalid_request');
  }

  const bot = await getMe(token);

  if (!chatId) {
    const chats = await discoverChats(token);
    return { connected: false, available_chats: chats };
  }

  const chat = await getChat(token, chatId);
  await assertBotIsAdmin(token, chatId, bot.id, chat.type);

  const connection = await saveConnection({
    workspaceId,
    platform: 'telegram',
    accountName: `@${bot.username}`,
    accountId: String(bot.id),
    accountType: 'bot',
    botTokenEncrypted: encrypt(token),
    config: {
      chat_id: String(chat.id),
      chat_title: chat.title ?? chat.username ?? String(chat.id),
      chat_type: chat.type,
      bot_username: bot.username,
    },
  });

  return { connected: true, connection };
}

async function telegramCall<T>(token: string, method: string, params?: Record<string, string>): Promise<T> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}${query}`);
  } catch (error) {
    console.error(`[auth-telegram] ${method} request failed:`, error);
    throw new ApiError(502, 'Could not reach Telegram. Please try again.', 'platform_unreachable');
  }

  const json = (await response.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string }
    | null;

  if (!json || !json.ok || json.result === undefined) {
    if (response.status === 401 || response.status === 404) {
      throw new ApiError(400, 'Invalid bot token.', 'invalid_credentials');
    }
    throw new ApiError(
      400,
      `Telegram rejected the request: ${json?.description ?? `HTTP ${response.status}`}`,
      'platform_error'
    );
  }
  return json.result;
}

async function getMe(token: string): Promise<TelegramBot> {
  return telegramCall<TelegramBot>(token, 'getMe');
}

async function getChat(token: string, chatId: string): Promise<TelegramChat> {
  try {
    return await telegramCall<TelegramChat>(token, 'getChat', { chat_id: chatId });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'platform_error') {
      throw new ApiError(
        400,
        'Chat not found. Add the bot to the channel/group first, then retry.',
        'chat_not_found'
      );
    }
    throw error;
  }
}

async function assertBotIsAdmin(
  token: string,
  chatId: string,
  botId: number,
  chatType: string
): Promise<void> {
  // Private chats have no admins — posting works as long as the user
  // started a conversation with the bot.
  if (chatType === 'private') return;

  const member = await telegramCall<{ status: string }>(token, 'getChatMember', {
    chat_id: chatId,
    user_id: String(botId),
  });
  if (member.status !== 'administrator' && member.status !== 'creator') {
    throw new ApiError(
      400,
      'The bot must be an administrator of this channel/group to post.',
      'bot_not_admin'
    );
  }
}

async function discoverChats(token: string): Promise<AvailableChat[]> {
  interface TelegramUpdate {
    message?: { chat: TelegramChat };
    channel_post?: { chat: TelegramChat };
    my_chat_member?: { chat: TelegramChat };
  }

  const updates = await telegramCall<TelegramUpdate[]>(token, 'getUpdates', { limit: '100' });
  const seen = new Map<string, AvailableChat>();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
    if (!chat) continue;
    seen.set(String(chat.id), {
      chat_id: String(chat.id),
      title: chat.title ?? chat.username ?? String(chat.id),
      type: chat.type,
    });
  }
  return [...seen.values()];
}
