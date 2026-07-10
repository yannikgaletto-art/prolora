// Client-side data access (F0-4, Pfad B).
//
// ONLY for Client Components ('use client'). Server Components import service
// functions from `lib/` directly — a Server Component that fetches its own API
// route makes a network roundtrip to talk to itself.
//
// Auth: the Supabase session lives in an httpOnly cookie that the browser
// attaches to same-origin requests automatically, and the API routes read it
// via `authenticateSession()`. No Authorization header to assemble.

const API_BASE = '/api';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ErrorBody {
  error?: string;
  code?: string;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiClientError(response.status, 'The server returned a malformed response.');
  }
}

// `fetchApi<PostsResponse>('/v1/posts')` -> GET /api/v1/posts
export async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined && !(options.body instanceof FormData);

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  // An expired session is not something a page can recover from.
  if (response.status === 401) {
    window.location.href = '/login';
    throw new ApiClientError(401, 'Your session has expired. Please sign in again.');
  }

  const body = await parseBody(response);

  if (!response.ok) {
    const { error, code } = body as ErrorBody;
    throw new ApiClientError(response.status, error ?? response.statusText, code);
  }

  return body as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
