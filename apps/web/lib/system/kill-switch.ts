import { getServiceDb, isMissingSchemaError } from '@/lib/db';

const SETTINGS_ROW_ID = 'global';

interface SystemSettingsRow {
  automation_enabled: boolean;
}

/**
 * Global emergency stop. Every Inngest function (cron and event-triggered)
 * calls this first and returns without doing paid work when it is false.
 *
 * Every failure path answers "disabled". A kill switch that cannot prove
 * spending was authorised must not authorise it: a missing table (Migration
 * 024 not applied yet — the deploy-before-migrate order is the normal one
 * here), a missing row, or an unreachable database all stop the jobs instead
 * of letting them run unguarded. The cost of a false stop is a paused cron;
 * the cost of a false start is real money.
 *
 * Call it OUTSIDE `step.run()`, at the top of the handler — that is
 * deliberate, not an oversight. Inngest replays the handler from the top on
 * every step boundary, so an unmemoized read re-checks the switch as the run
 * progresses and stops work already in flight. Wrapping it in `step.run()`
 * would memoize the first answer for the whole run, which is exactly wrong
 * for the functions that matter most here: `publishFirstComment` sleeps 30m
 * and `publishPostEffects` sleeps 1h before spending anything. The price is
 * one indexed single-row lookup per step boundary.
 */
export async function isAutomationEnabled(): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('system_settings')
    .select('automation_enabled')
    .eq('id', SETTINGS_ROW_ID)
    .maybeSingle<SystemSettingsRow>();

  if (error) {
    if (!isMissingSchemaError(error.code)) {
      console.error('[kill-switch] read failed — treating automation as disabled:', error.message);
    }
    return false;
  }
  return data?.automation_enabled ?? false;
}

/**
 * Writes stay strict: a failed flip must be reported, never silently
 * swallowed, or the UI would show a state the backend does not have.
 */
export async function setAutomationEnabled(enabled: boolean): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('system_settings')
    .upsert({ id: SETTINGS_ROW_ID, automation_enabled: enabled, updated_at: new Date().toISOString() });
  if (error) {
    if (isMissingSchemaError(error.code)) {
      throw new Error('Migration 024 is not applied yet — apply it before switching automation on.');
    }
    throw new Error(`[kill-switch] write failed: ${error.message}`);
  }
}
