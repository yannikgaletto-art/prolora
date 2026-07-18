import { z } from 'zod';
import { ApiError } from '@/lib/api/http';
import { encrypt } from '@/lib/auth/encryption';
import { saveConnection, toConnectionDto } from '@/lib/auth/connections';

const inputSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('discord'), credential: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname) && /^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname);
  }, 'Use a valid Discord incoming webhook URL.') }),
  z.object({ platform: z.literal('devto'), credential: z.string().min(8).max(500) }),
  z.object({
    platform: z.literal('hashnode'),
    credential: z.string().min(8).max(1000),
    publication_host: z.string().trim().min(3).max(253).regex(/^(?!https?:\/\/)[a-z0-9.-]+$/i, 'Enter only the publication host.'),
  }),
]);

export type CredentialConnectInput = z.infer<typeof inputSchema>;

export function parseCredentialConnectInput(input: unknown): CredentialConnectInput {
  return inputSchema.parse(input);
}

export function buildHashnodeVerificationRequest(host: string) {
  return {
    query: 'query Connect($host: String!) { me { id username name publications(first: 50) { edges { node { id title } } } } publication(host: $host) { id title } }',
    variables: { host },
  };
}

type HashnodeVerificationBody = {
  data?: {
    me?: {
      id: string;
      username?: string;
      name?: string;
      publications?: { edges?: Array<{ node?: { id: string; title?: string } }> };
    };
    publication?: { id: string; title?: string };
  };
  errors?: Array<{ message: string }>;
};

export function resolveOwnedHashnodePublication(body: HashnodeVerificationBody): { id: string; name: string; publicationId: string } {
  const me = body.data?.me;
  const publication = body.data?.publication;
  if (!me?.id || !publication?.id) {
    throw new ApiError(400, 'Hashnode returned no account or publication.', 'invalid_credential');
  }
  const owned = me.publications?.edges?.some((edge) => edge.node?.id === publication.id) ?? false;
  if (!owned) {
    throw new ApiError(400, 'This publication is not owned by the authenticated Hashnode account.', 'invalid_credential');
  }
  return {
    id: `${me.id}:${publication.id}`,
    name: publication.title ?? me.name ?? me.username ?? 'Hashnode publication',
    publicationId: publication.id,
  };
}

export async function connectCredentialPlatform(workspaceId: string, raw: unknown) {
  const input = parseCredentialConnectInput(raw);
  const identity = await verify(input);
  const row = await saveConnection({
    workspaceId,
    platform: input.platform,
    accountName: identity.name,
    accountId: identity.id,
    accountType: input.platform === 'discord' ? 'bot' : 'creator',
    accessTokenEncrypted: encrypt(input.credential),
    config: input.platform === 'hashnode'
      ? { publication_id: identity.publicationId, publication_host: input.publication_host }
      : input.platform === 'discord'
        ? { channel_id: identity.channelId, guild_id: identity.guildId }
        : {},
  });
  return toConnectionDto(row);
}

async function verify(input: CredentialConnectInput): Promise<{ id: string; name: string; channelId?: string; guildId?: string; publicationId?: string }> {
  let response: Response;
  try {
    if (input.platform === 'discord') {
      response = await fetch(input.credential, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new ApiError(400, 'Discord rejected this webhook URL.', 'invalid_credential');
      const body = (await response.json()) as { id?: string; name?: string | null; channel_id?: string | null; guild_id?: string | null };
      if (!body.id) throw new ApiError(400, 'Discord returned an invalid webhook.', 'invalid_credential');
      return { id: body.id, name: body.name ?? `Discord webhook ${body.id}`, channelId: body.channel_id ?? undefined, guildId: body.guild_id ?? undefined };
    }
    if (input.platform === 'devto') {
      response = await fetch('https://dev.to/api/users/me', { headers: { Accept: 'application/vnd.forem.api-v1+json', 'api-key': input.credential }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new ApiError(400, 'Dev.to rejected this API key.', 'invalid_credential');
      const body = (await response.json()) as { id?: number; username?: string; name?: string };
      if (!body.id) throw new ApiError(400, 'Dev.to returned no user for this key.', 'invalid_credential');
      return { id: String(body.id), name: body.name ?? body.username ?? `Dev.to user ${body.id}` };
    }
    response = await fetch('https://gql.hashnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: input.credential },
      body: JSON.stringify(buildHashnodeVerificationRequest(input.publication_host)),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as HashnodeVerificationBody | null;
    if (!response.ok || body?.errors?.length || !body) {
      throw new ApiError(400, 'Hashnode rejected the PAT or publication host. A Pro publication is required.', 'invalid_credential');
    }
    return resolveOwnedHashnodePublication(body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'The provider could not be reached. Try again shortly.', 'platform_unreachable');
  }
}
