import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ensureWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { PATHNAME_HEADER } from '@/lib/http-headers';

// Auth gate + workspace lifecycle (F0-1, Oracle 3).
//
// Redirect chain:
//   unauthenticated                          -> /login
//   authenticated, no workspace              -> auto-create -> /onboarding
//   authenticated, onboarding_completed=false -> /onboarding
//   authenticated, onboarding_completed=true  -> /publish
//
// Runs on the user's own session (anon key + JWT). RLS permits the workspace
// bootstrap, so no service-role key ever reaches the Edge runtime.

const PUBLIC_PATHS = ['/login', '/register'];

// /board/<slug> is the public feedback board (F5-2) — readable without a
// session. /board itself is the authenticated admin view.
const PUBLIC_BOARD = /^\/board\/[^/]+/;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_BOARD.test(pathname);
}

export async function middleware(request: NextRequest) {
  // Rebuilt after every cookie mutation so the forwarded request carries the
  // rotated session.
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return headers;
  };

  // Reassigned by setAll() whenever Supabase rotates the session cookies.
  let response = NextResponse.next({ request: { headers: forwardedHeaders() } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: forwardedHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as never)
          );
        },
      },
    }
  );

  // Refreshed cookies must survive the redirect, or the session is lost on the
  // very request that established it.
  const redirectTo = (pathname: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user) {
    return isPublicPath(pathname) ? response : redirectTo('/login');
  }

  // A signed-in owner viewing their own public board stays on the public view.
  if (PUBLIC_BOARD.test(pathname)) return response;

  let workspace;
  try {
    workspace = await ensureWorkspace(supabase, user.id, user.email ?? '');
  } catch (error) {
    // A degraded DB must not lock every route behind a 500 — let the page
    // render and surface the failure in its own error boundary.
    console.error('[middleware] workspace lifecycle failed:', error);
    return response;
  }

  const home = workspace.onboardingCompleted ? '/publish' : '/onboarding';

  if (pathname === '/' || PUBLIC_PATHS.includes(pathname)) {
    return redirectTo(home);
  }
  if (!workspace.onboardingCompleted && pathname !== '/onboarding') {
    return redirectTo('/onboarding');
  }
  if (workspace.onboardingCompleted && pathname === '/onboarding') {
    return redirectTo('/publish');
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals and static assets.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
