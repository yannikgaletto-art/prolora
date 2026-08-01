// Confirmed facts are immutable timeline entries. Service-role access is always
// workspace-scoped; suggestions cannot enter this module without an explicit RPC.
import type { ProofAssetType } from '@prolora/shared';
import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

export type FactKind =
  | 'current_state'
  | 'historical_state'
  | 'event'
  | 'metric'
  | 'financial'
  | 'policy';
export type FactStatus = 'confirmed' | 'superseded' | 'revoked';
export type FactDirectionPolicy = 'free' | 'warn_on_decrease' | 'warn_on_increase';
export type FactValue = { number: number } | { text: string } | { boolean: boolean };

export interface ConfirmedFact {
  id: string;
  factKey: string;
  factKind: FactKind;
  value: FactValue;
  unit: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: FactStatus;
  directionPolicy: FactDirectionPolicy;
  changeReason: string | null;
  verifiedAt: string;
}

interface FactRow {
  id: string;
  fact_key: string;
  fact_kind: FactKind;
  fact_value: FactValue;
  fact_unit: string | null;
  effective_from: string;
  effective_to: string | null;
  fact_status: FactStatus;
  direction_policy: FactDirectionPolicy;
  fact_change_reason: string | null;
  verified_at: string;
}

export interface ConfirmFactInput {
  type: ProofAssetType;
  content: string;
  sourceUrl?: string | null;
  factKey: string;
  factKind: FactKind;
  value: FactValue;
  unit?: string | null;
  effectiveFrom: string;
  directionPolicy: FactDirectionPolicy;
  changeReason?: string | null;
}

const FACT_COLUMNS = [
  'id', 'fact_key', 'fact_kind', 'fact_value', 'fact_unit', 'effective_from',
  'effective_to', 'fact_status', 'direction_policy', 'fact_change_reason', 'verified_at',
].join(', ');

const MIGRATION_PENDING = new ApiError(
  503,
  'Facts Timeline storage is not set up yet — apply migration 023.',
  'migration_pending'
);

function toFact(row: FactRow): ConfirmedFact {
  return {
    id: row.id,
    factKey: row.fact_key,
    factKind: row.fact_kind,
    value: row.fact_value,
    unit: row.fact_unit,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.fact_status,
    directionPolicy: row.direction_policy,
    changeReason: row.fact_change_reason,
    verifiedAt: row.verified_at,
  };
}

function factTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid fact timestamp: ${value}`);
  return timestamp;
}

export function resolveFactsAt(
  facts: readonly ConfirmedFact[],
  asOf: string
): ConfirmedFact[] {
  const at = factTimestamp(asOf);
  const resolved = new Map<string, ConfirmedFact>();
  for (const fact of facts) {
    if (fact.status === 'revoked') continue;
    const from = factTimestamp(fact.effectiveFrom);
    const to = fact.effectiveTo ? factTimestamp(fact.effectiveTo) : Number.POSITIVE_INFINITY;
    if (from > at || at >= to) continue;
    const previous = resolved.get(fact.factKey);
    if (!previous || factTimestamp(previous.effectiveFrom) < from) resolved.set(fact.factKey, fact);
  }
  return [...resolved.values()].sort((left, right) => left.factKey.localeCompare(right.factKey));
}

const numberValue = (value: FactValue): number | null =>
  'number' in value && Number.isFinite(value.number) ? value.number : null;

export function validateFactDirectionChange(
  previous: ConfirmedFact | null,
  nextValue: FactValue,
  changeReason: string | null | undefined
): void {
  if (!previous || previous.directionPolicy === 'free') return;
  const before = numberValue(previous.value);
  const after = numberValue(nextValue);
  if (before === null || after === null) return;
  const breaksPolicy =
    (previous.directionPolicy === 'warn_on_decrease' && after < before) ||
    (previous.directionPolicy === 'warn_on_increase' && after > before);
  if (breaksPolicy && !changeReason?.trim()) {
    throw new ApiError(400, 'A direction-policy change requires a written reason.', 'fact_change_reason_required');
  }
}

export async function listFactHistory(
  workspaceId: string,
  options: { factKey?: string; limit?: number } = {}
): Promise<ConfirmedFact[]> {
  const db = getServiceDb();
  let query = db
    .from('proof_assets')
    .select(FACT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .not('fact_key', 'is', null)
    .order('effective_from', { ascending: false })
    .limit(Math.min(options.limit ?? 200, 500));
  if (options.factKey) query = query.eq('fact_key', options.factKey);
  const { data, error } = await query.returns<FactRow[]>();
  if (error) {
    if (isMissingSchemaError(error.code)) return [];
    throw new Error(`[facts] timeline lookup failed: ${error.message}`);
  }
  return (data ?? []).map(toFact);
}

export async function listFactsAt(workspaceId: string, asOf: string): Promise<ConfirmedFact[]> {
  return resolveFactsAt(await listFactHistory(workspaceId), asOf);
}

export async function confirmFact(
  workspaceId: string,
  input: ConfirmFactInput,
  confirmedBy: string
): Promise<ConfirmedFact> {
  const history = await listFactHistory(workspaceId, { factKey: input.factKey });
  validateFactDirectionChange(
    history.find((fact) => fact.status === 'confirmed' && fact.effectiveTo === null) ?? null,
    input.value,
    input.changeReason
  );
  const db = getServiceDb();
  const { data, error } = await db.rpc('upsert_confirmed_fact_atomic', {
    p_workspace_id: workspaceId,
    p_type: input.type,
    p_content: input.content.trim(),
    p_source_url: input.sourceUrl ?? null,
    p_fact_key: input.factKey.trim(),
    p_fact_kind: input.factKind,
    p_fact_value: input.value,
    p_fact_unit: input.unit ?? null,
    p_effective_from: input.effectiveFrom,
    p_direction_policy: input.directionPolicy,
    p_fact_change_reason: input.changeReason?.trim() || null,
    p_confirmed_by: confirmedBy,
  });
  if (error) {
    if (isMissingSchemaError(error.code) || error.code === 'PGRST202') throw MIGRATION_PENDING;
    throw new Error(`[facts] confirmation failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as FactRow | null;
  if (!row) throw new Error('[facts] confirmation returned no row');
  return toFact(row);
}

export async function confirmFactSuggestion(
  workspaceId: string,
  suggestionId: string,
  confirmedBy: string
): Promise<ConfirmedFact> {
  const db = getServiceDb();
  const { data, error } = await db.rpc('confirm_fact_suggestion_atomic', {
    p_workspace_id: workspaceId,
    p_suggestion_id: suggestionId,
    p_confirmed_by: confirmedBy,
  });
  if (error) {
    if (isMissingSchemaError(error.code) || error.code === 'PGRST202') throw MIGRATION_PENDING;
    if (error.code === 'P0002') throw new ApiError(404, 'Fact suggestion not found.', 'not_found');
    throw new Error(`[facts] suggestion confirmation failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as FactRow | null;
  if (!row) throw new Error('[facts] suggestion confirmation returned no row');
  return toFact(row);
}

export async function revokeFact(
  workspaceId: string,
  factId: string,
  effectiveTo = new Date().toISOString()
): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('proof_assets')
    .update({ fact_status: 'revoked', effective_to: effectiveTo })
    .eq('workspace_id', workspaceId)
    .eq('id', factId)
    .not('fact_key', 'is', null)
    .eq('fact_status', 'confirmed')
    .select('id');
  if (error) {
    if (isMissingSchemaError(error.code)) throw MIGRATION_PENDING;
    throw new Error(`[facts] revoke failed: ${error.message}`);
  }
  return (data ?? []).length === 1;
}
