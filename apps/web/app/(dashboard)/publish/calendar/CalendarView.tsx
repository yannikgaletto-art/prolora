'use client';

// Month calendar (GOAL-RUN6 Phase 2). Groups are placed by their scheduled_at
// in the VIEWER's zone; the detail panel additionally names the authored zone
// (scheduled_tz) so a moved clock never silently shifts a slot. Status is
// encoded as dot color AND text (never color-only). Reschedule = PATCH
// /schedule; the cron sweep honors the new time — no client-side timers.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { CalendarGroup, CalendarGroupStatus } from '@/lib/posts/calendar';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const STATUS_META: Record<CalendarGroupStatus, { dot: string; label: string }> = {
  draft: { dot: 'bg-gray-400', label: 'Draft' },
  scheduled: { dot: 'bg-primary-600', label: 'Scheduled' },
  queued: { dot: 'bg-sky-500', label: 'Queued' },
  publishing: { dot: 'bg-amber-500', label: 'Publishing' },
  published: { dot: 'bg-green-600', label: 'Published' },
  failed: { dot: 'bg-red-600', label: 'Failed' },
  deleted: { dot: 'bg-gray-300', label: 'Deleted' },
};

interface CalendarViewProps {
  initialGroups: CalendarGroup[];
  initialDrafts: CalendarGroup[];
}

interface MonthCursor {
  year: number;
  month: number; // 0-based
}

function startOfGrid(cursor: MonthCursor): Date {
  const first = new Date(cursor.year, cursor.month, 1);
  const weekday = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first);
  start.setDate(first.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarView({ initialGroups, initialDrafts }: CalendarViewProps) {
  const router = useRouter();
  const now = new Date();
  const [cursor, setCursor] = useState<MonthCursor>({ year: now.getFullYear(), month: now.getMonth() });
  const [groups, setGroups] = useState<CalendarGroup[]>(initialGroups);
  const [drafts, setDrafts] = useState<CalendarGroup[]>(initialDrafts);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CalendarGroup | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');
  const [mutating, setMutating] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const gridStart = useMemo(() => startOfGrid(cursor), [cursor]);
  const cells = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [gridStart]);

  const loadRange = useCallback(async (c: MonthCursor) => {
    const start = startOfGrid(c);
    const end = new Date(start);
    end.setDate(start.getDate() + 42);
    setLoading(true);
    try {
      const data = await fetchApi<{ groups: CalendarGroup[]; drafts: CalendarGroup[] }>(
        `/v1/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`
      );
      setGroups(data.groups);
      setDrafts(data.drafts);
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch with exact grid bounds in the viewer's zone after mount and on
  // month navigation (the SSR window was a UTC approximation).
  useEffect(() => {
    void loadRange(cursor);
  }, [cursor, loadRange]);

  const groupsByDay = useMemo(() => {
    const map = new Map<string, CalendarGroup[]>();
    for (const group of groups) {
      if (!group.scheduled_at) continue;
      const key = dateKey(new Date(group.scheduled_at));
      const list = map.get(key) ?? [];
      list.push(group);
      map.set(key, list);
    }
    return map;
  }, [groups]);

  function openGroup(group: CalendarGroup) {
    setSelected(group);
    setRescheduleValue(group.scheduled_at ? toDatetimeLocal(group.scheduled_at) : '');
  }

  async function submitReschedule() {
    if (!selected || !rescheduleValue) return;
    setMutating(true);
    try {
      const iso = new Date(rescheduleValue).toISOString();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await fetchApi(`/v1/posts/${selected.post_group_id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduled_at: iso, scheduled_tz: tz }),
      });
      setToast({ variant: 'success', message: 'Rescheduled.' });
      setSelected(null);
      await loadRange(cursor);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setMutating(false);
    }
  }

  async function submitPublishNow() {
    if (!selected) return;
    setMutating(true);
    try {
      await fetchApi(`/v1/posts/${selected.post_group_id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ publish_now: true }),
      });
      setToast({ variant: 'success', message: 'Queued for publishing.' });
      setSelected(null);
      await loadRange(cursor);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setMutating(false);
    }
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
  const todayKey = dateKey(new Date());

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))}
            aria-label="Previous month"
          >
            ←
          </Button>
          <span className="min-w-40 text-center text-sm font-semibold text-gray-900">{monthLabel}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))}
            aria-label="Next month"
          >
            →
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
          >
            Heute
          </Button>
          {loading && <span className="text-xs text-gray-400">Lädt…</span>}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-gray-500">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day) => {
              const key = dateKey(day);
              const dayGroups = groupsByDay.get(key) ?? [];
              const inMonth = day.getMonth() === cursor.month;
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={`min-h-24 border-b border-r border-gray-100 p-1.5 ${inMonth ? 'bg-white' : 'bg-gray-50'}`}
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                      isToday ? 'bg-primary-600 font-semibold text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayGroups.slice(0, 3).map((group) => {
                      const meta = STATUS_META[group.group_status];
                      const time = group.scheduled_at
                        ? new Date(group.scheduled_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                        : '';
                      return (
                        <button
                          key={group.post_group_id}
                          type="button"
                          onClick={() => openGroup(group)}
                          className="flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                          title={`${meta.label}: ${group.content_preview}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                          <span className="truncate">
                            {time} {group.content_preview}
                          </span>
                        </button>
                      );
                    })}
                    {dayGroups.length > 3 && (
                      <p className="px-1 text-[10px] text-gray-400">+{dayGroups.length - 3} weitere</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          {(['draft', 'scheduled', 'publishing', 'published', 'failed'] as CalendarGroupStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} aria-hidden="true" />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {selected ? (
          <Card>
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[selected.group_status].dot}`} aria-hidden="true" />
                {STATUS_META[selected.group_status].label}
              </span>
              <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setSelected(null)}>
                Schließen
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">{selected.content_preview}</p>
            {selected.scheduled_tz && (
              <p className="mt-2 text-xs text-gray-400">Geplant in Zone: {selected.scheduled_tz}</p>
            )}
            <ul className="mt-3 space-y-1">
              {selected.items.map((item) => (
                <li key={item.post_item_id} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[item.status as CalendarGroupStatus]?.dot ?? 'bg-gray-300'}`} aria-hidden="true" />
                  <span className="font-medium">{item.platform}</span>
                  <span>{item.status}</span>
                  {item.error_message && <span className="truncate text-red-600" title={item.error_message}>{item.error_message}</span>}
                </li>
              ))}
            </ul>

            {['draft', 'scheduled', 'queued', 'failed'].includes(selected.group_status) && (
              <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                <label className="block text-xs font-medium text-gray-600">
                  Neuer Zeitpunkt
                  <input
                    type="datetime-local"
                    value={rescheduleValue}
                    onChange={(e) => setRescheduleValue(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitReschedule} loading={mutating} disabled={!rescheduleValue}>
                    {selected.group_status === 'draft' ? 'Einplanen' : 'Verschieben'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={submitPublishNow} loading={mutating}>
                    Jetzt veröffentlichen
                  </Button>
                </div>
                <p className="text-[11px] text-gray-400">
                  „Jetzt veröffentlichen" stellt in die Warteschlange — der nächste Lauf (≤5 Min) publiziert.
                </p>
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-gray-500">Klicke einen Eintrag im Kalender, um Details zu sehen und umzuplanen.</p>
          </Card>
        )}

        <Card>
          <h3 className="text-sm font-semibold text-gray-900">Drafts ohne Termin</h3>
          {drafts.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">Keine — erzeuge welche im Content Hub.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {drafts.map((draft) => (
                <li key={draft.post_group_id}>
                  <button
                    type="button"
                    onClick={() => openGroup(draft)}
                    className="flex w-full items-center gap-1.5 truncate rounded px-1 py-1 text-left text-xs text-gray-700 hover:bg-gray-100"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" aria-hidden="true" />
                    <span className="truncate">{draft.content_preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
