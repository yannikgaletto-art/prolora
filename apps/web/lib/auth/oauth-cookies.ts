// Cookie names/options shared between the OAuth initiate and callback routes.

export const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 600,
  path: '/api/auth',
};

export const PKCE_COOKIE = 'prolora_pkce_verifier';

export function stateCookieName(platform: string): string {
  return `prolora_oauth_state_${platform}`;
}
