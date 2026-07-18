// SSRF guard for server-side fetches of user-supplied URLs (GOAL-RUN6 §4.4).
// Blocks the obvious internal surfaces (localhost, private/link-local/metadata
// IP literals, .local/.internal names, non-http schemes, exotic ports).
// Limitation (documented): hostnames are NOT DNS-resolved here, so a public
// name pointing at an internal IP is not caught — acceptable for the current
// single-operator deployment, revisit before multi-tenant self-serve.
import { ApiError } from '@/lib/api/http';

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::1]', '::1']);

const PRIVATE_V4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, 'Not a valid URL.', 'invalid_url');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError(400, 'Only http(s) URLs are allowed.', 'invalid_url');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new ApiError(400, 'Non-standard ports are not allowed.', 'invalid_url');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ApiError(400, 'This host is not reachable from Prolora.', 'blocked_url');
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new ApiError(400, 'This host is not reachable from Prolora.', 'blocked_url');
  }
  // IPv6 literal or private IPv4 literal.
  if (host.startsWith('[') || PRIVATE_V4_PATTERNS.some((p) => p.test(host))) {
    throw new ApiError(400, 'IP-literal hosts are not allowed.', 'blocked_url');
  }

  return url;
}
