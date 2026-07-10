import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(status: number, message: string, code?: string): NextResponse {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

// Maps thrown errors to structured JSON responses. Never leaks stack traces.
export function handleRouteError(context: string, error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.message, error.code);
  }
  if (error instanceof ZodError) {
    const detail = error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return jsonError(400, `Invalid request: ${detail}`, 'invalid_request');
  }
  console.error(`[${context}] failed:`, error);
  return jsonError(500, 'Internal server error.', 'internal_error');
}
