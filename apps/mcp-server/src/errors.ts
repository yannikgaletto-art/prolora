// MCP-conform error handling. API errors never crash the process — every
// tool handler catches them and returns a structured MCP error response
// (see toToolError below) instead of throwing past the SDK.

export class ProloraApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ProloraApiError';
  }
}

export interface ToolErrorResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

// Translates any thrown error into a user-facing MCP error response. Never
// includes a stack trace — Claude shows this text directly to the user.
export function toToolError(error: unknown): ToolErrorResult {
  return { content: [{ type: 'text', text: `Error: ${describeError(error)}` }], isError: true };
}

function describeError(error: unknown): string {
  if (error instanceof ProloraApiError) {
    switch (error.status) {
      case 401:
        return 'API-Key ungültig oder abgelaufen. Prüfe PROLORA_API_KEY.';
      case 402:
        return 'Credit-Limit erreicht. Upgrade deinen Plan auf prolora.eu.';
      case 404:
        return 'Nicht gefunden. Prüfe die angegebene ID.';
      case 409:
        return error.message || 'Aktion aktuell nicht möglich (Konflikt).';
      case 429:
        return error.retryAfterSeconds
          ? `Rate-Limit erreicht. Versuche es in ${error.retryAfterSeconds} Sekunden erneut.`
          : 'Rate-Limit erreicht. Versuche es in Kürze erneut.';
      default:
        if (error.status >= 500) {
          return 'Prolora-Server nicht erreichbar. Versuche es in einer Minute erneut.';
        }
        return error.message || 'Anfrage an Prolora fehlgeschlagen.';
    }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Zeitüberschreitung bei der Anfrage an Prolora. Versuche es erneut.';
    }
    return error.message;
  }
  return 'Unbekannter Fehler.';
}
