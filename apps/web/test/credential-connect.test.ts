import { describe, expect, it } from 'vitest';
import { buildHashnodeVerificationRequest, parseCredentialConnectInput, resolveOwnedHashnodePublication } from '../lib/connections/credential-connect';

describe('credential connector input', () => {
  it('accepts Discord webhook URLs only on Discord webhook hosts and paths', () => {
    expect(parseCredentialConnectInput({ platform: 'discord', credential: 'https://discord.com/api/webhooks/123/token' }).platform).toBe('discord');
    expect(() => parseCredentialConnectInput({ platform: 'discord', credential: 'https://evil.example/api/webhooks/123/token' })).toThrow();
  });

  it('requires a publication host for Hashnode and uses the documented host lookup', () => {
    expect(() => parseCredentialConnectInput({ platform: 'hashnode', credential: 'hashnode-pat' })).toThrow();
    expect(parseCredentialConnectInput({ platform: 'hashnode', credential: 'hashnode-pat', publication_host: 'blog.example.com' })).toMatchObject({ publication_host: 'blog.example.com' });
    const request = buildHashnodeVerificationRequest('blog.example.com');
    expect(request.query).toContain('publication(host: $host)');
    expect(request.query).not.toContain('publication(id:');
    expect(request.variables).toEqual({ host: 'blog.example.com' });
  });

  it('accepts only a publication listed on the authenticated Hashnode account', () => {
    const body = {
      data: {
        me: { id: 'user-1', username: 'demo', publications: { edges: [{ node: { id: 'owned-1', title: 'Owned blog' } }] } },
        publication: { id: 'owned-1', title: 'Owned blog' },
      },
    };
    expect(resolveOwnedHashnodePublication(body)).toMatchObject({ id: 'user-1:owned-1', publicationId: 'owned-1' });
    expect(() => resolveOwnedHashnodePublication({ ...body, data: { ...body.data, publication: { id: 'foreign-1', title: 'Foreign' } } })).toThrow(/owned/i);
  });
});
