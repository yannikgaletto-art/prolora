// Server-only locale resolution (next/headers must not leak into client code).
import { cookies, headers } from 'next/headers';
import type { AppLocale } from '@prolora/shared';
import { LOCALE_COOKIE, isAppLocale, parseAcceptLanguage } from './index';

/** Cookie → Accept-Language → 'de' (GOAL-RUN5 D7). */
export async function getLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isAppLocale(fromCookie)) return fromCookie;
  const headerStore = await headers();
  return parseAcceptLanguage(headerStore.get('accept-language'));
}
