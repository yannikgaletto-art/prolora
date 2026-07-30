export const LEGACY_RECONCILIATION_PREFIX = '[reconciliation_required]';

export function isLegacyReconciliationRequired(
  row: { status: string; error_message?: string | null }
): boolean {
  return (
    row.status === 'failed' &&
    Boolean(row.error_message?.startsWith(LEGACY_RECONCILIATION_PREFIX))
  );
}

export function legacyReconciliationMessage(message: string | null): string {
  return `${LEGACY_RECONCILIATION_PREFIX} ${
    message ?? 'Publishing outcome is unknown. Confirm on the platform before retrying.'
  }`.slice(0, 1000);
}
