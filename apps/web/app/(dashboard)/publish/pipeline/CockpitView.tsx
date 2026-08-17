'use client';

// Tages-Cockpit der Content-Fabrik (Plan 2 / 2B.5).
//
// Bewusst KEIN Kalenderraster: bei 2–3 Posts/Tag beantwortet ein Raster die
// falsche Frage. Interessant ist „was hält gerade auf" — 3 geplant, 2 im Gate,
// 1 braucht Proof. Ein Gate-Befund ohne konkreten nächsten Schritt wäre eine
// Beschwerde; deshalb trägt jeder Befund seine `remedy` und markiert seinen
// `span` inline.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/app/components/Badge';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import { Modal } from '@/app/components/Modal';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { errorMessage, fetchApi } from '@/app/lib/api';
import type { GateFinding, GateResult, GateStats } from '@/lib/pipeline/quality-gate';
import type {
  ContentItemRow,
  ContentItemState,
  ContentItemVariantRow,
} from '@/lib/pipeline/state';
import type { CockpitCounts, PipelineEstimate } from '@/lib/pipeline/orchestrator';
import { fillCopy, type PipelineCopy } from './copy';
import {
  coverageTone,
  findingTone,
  primaryRemedy,
  provenanceChain,
  splitBySpan,
  STATE_TONES,
} from './cockpit-logic';

interface ItemDetail {
  item: ContentItemRow;
  variants: ContentItemVariantRow[];
  provenance: string;
}

interface GateResponse {
  item: ContentItemRow;
  results: Array<{ variantId: string; channelKey: string; gate: GateResult }>;
  stats: GateStats;
}

export function CockpitView({
  copy,
  counts,
  items,
  gate,
}: {
  copy: PipelineCopy;
  counts: CockpitCounts;
  items: ContentItemRow[];
  gate: GateStats;
}) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busy, setBusy] = useState<null | 'run' | 'schedule' | 'gate'>(null);
  const [estimate, setEstimate] = useState<PipelineEstimate | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [gateResults, setGateResults] = useState<GateResponse | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const openItems = useMemo(
    () => items.filter((item) => item.state !== 'rejected' && item.state !== 'measured'),
    [items]
  );

  async function loadEstimate() {
    try {
      const response = await fetchApi<{ estimate: PipelineEstimate }>('/v1/pipeline/run', {
        method: 'POST',
        body: JSON.stringify({ estimate_only: true }),
      });
      setEstimate(response.estimate);
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    }
  }

  async function runPipeline() {
    setBusy('run');
    try {
      await fetchApi('/v1/pipeline/run', { method: 'POST', body: JSON.stringify({ limit: 5 }) });
      window.location.reload();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function scheduleByMix() {
    setBusy('schedule');
    try {
      await fetchApi('/v1/pipeline/schedule', { method: 'POST', body: JSON.stringify({ take: 3 }) });
      window.location.reload();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(itemId: string) {
    try {
      const response = await fetchApi<ItemDetail>(`/v1/pipeline/items/${itemId}`);
      setDetail(response);
      setGateResults(null);
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    }
  }

  async function runGate(itemId: string) {
    setBusy('gate');
    try {
      const response = await fetchApi<GateResponse>(`/v1/pipeline/items/${itemId}/gate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setGateResults(response);
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function submitOverride(itemId: string, variantId: string) {
    try {
      await fetchApi(`/v1/pipeline/items/${itemId}/override`, {
        method: 'POST',
        body: JSON.stringify({ variant_id: variantId, reason: overrideReason }),
      });
      setToast({ variant: 'success', message: copy.override_done });
      setOverrideFor(null);
      setOverrideReason('');
      await openDetail(itemId);
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}

      <Card
        title={copy.today_headline}
        description={copy.subtitle}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={loadEstimate}>
              {copy.estimate_title}
            </Button>
            <Button size="sm" loading={busy === 'run'} onClick={runPipeline}>
              {busy === 'run' ? copy.running : copy.run_button}
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <CountPill value={counts.scheduledToday} label={copy.count_scheduled} tone="amber" />
          <CountPill value={counts.inGate} label={copy.count_in_gate} tone="teal" />
          <CountPill value={counts.needsProof} label={copy.count_needs_proof} tone="red" />
          <CountPill value={counts.blocked} label={copy.count_blocked} tone="red" />
          {counts.stalled > 0 && (
            <CountPill value={counts.stalled} label={copy.count_stalled} tone="gray" />
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-gray-500">{copy.coverage_label}</span>
            <Badge
              tone={coverageTone(
                counts.coverageDays,
                counts.scheduledToday + counts.inGate + counts.needsProof + counts.blocked + counts.stalled > 0
              )}
            >
              {counts.coverageDays === null
                ? copy.coverage_unknown
                : fillCopy(copy.coverage_days, { days: counts.coverageDays })}
            </Badge>
          </span>
        </div>
        {/* GOAL-RUN11 D6: nur warnen, wenn die Fabrik überhaupt läuft — ein
            leerer Account bekommt keine rote Warnung vor dem ersten Post. */}
        {counts.coverageDays !== null &&
          counts.coverageDays < 3 &&
          counts.scheduledToday + counts.inGate + counts.needsProof + counts.blocked + counts.stalled > 0 && (
            <p className="mt-3 text-sm text-red-700">{copy.coverage_warning}</p>
          )}
        {estimate && (
          <div className="mt-4 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-medium text-gray-900">{copy.estimate_title}</p>
            <p className="mt-1">
              {fillCopy(copy.estimate_line, {
                items: estimate.items,
                channels: estimate.channels,
                calls: estimate.calls,
                credits: estimate.totalCredits,
              })}
            </p>
            {estimate.savedCredits > 0 && (
              <p className="mt-1 text-gray-500">
                {fillCopy(copy.estimate_saved, { saved: estimate.savedCredits })}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card
        title={copy.gate_stats_title}
        description={copy.gate_stats_hint}
        actions={
          <Button variant="secondary" size="sm" loading={busy === 'schedule'} onClick={scheduleByMix}>
            {busy === 'schedule' ? copy.scheduling : copy.schedule_button}
          </Button>
        }
      >
        <p className="text-sm text-gray-700">
          {fillCopy(copy.gate_stats_line, {
            passed: gate.passed,
            blocked: gate.blocked,
            overridden: gate.overridden,
          })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(gate.blockedBy) as Array<keyof GateStats['blockedBy']>).map((check) =>
            gate.blockedBy[check] > 0 ? (
              <Badge key={check} tone="red">
                {copy.checks[check]}: {gate.blockedBy[check]}
              </Badge>
            ) : null
          )}
          {(Object.keys(gate.skipped) as Array<keyof GateStats['skipped']>).map((check) =>
            gate.skipped[check] > 0 ? (
              <Badge key={`skip-${check}`} tone="gray">
                {copy.checks[check]}: {gate.skipped[check]} ({copy.gate_skipped_note})
              </Badge>
            ) : null
          )}
        </div>
      </Card>

      {openItems.length === 0 ? (
        <EmptyState title={copy.empty_title} description={copy.empty_description} />
      ) : (
        <Card flush>
          <ul className="divide-y divide-gray-200">
            {openItems.map((item) => {
              const chain = provenanceChain(item.evidence, copy);
              return (
                <li key={item.id} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATE_TONES[item.state as ContentItemState]}>
                        {copy.states[item.state as ContentItemState]}
                      </Badge>
                      <Badge tone="blue">{copy.mix[item.mix_bucket]}</Badge>
                      {item.stalled_at && <Badge tone="gray">{copy.count_stalled}</Badge>}
                      <span className="truncate text-sm font-medium text-gray-900">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {copy.provenance_title}:{' '}
                      {chain.length > 0 ? chain.join(' → ') : copy.provenance_empty}
                    </p>
                    {item.state === 'rejected' && item.rejected_reason && (
                      <p className="mt-1 text-xs text-red-700">{item.rejected_reason}</p>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => openDetail(item.id)}>
                    {copy.gate_title}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {detail && (
        <Modal open onClose={() => setDetail(null)} title={detail.item.title}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {copy.provenance_title}: {detail.provenance}
            </p>
            <Button size="sm" loading={busy === 'gate'} onClick={() => runGate(detail.item.id)}>
              {busy === 'gate' ? copy.gate_running : copy.gate_button}
            </Button>

            <h3 className="text-sm font-semibold text-gray-900">{copy.variants_title}</h3>
            {detail.variants.map((variant) => {
              const result = gateResults?.results.find((entry) => entry.variantId === variant.id);
              const findings: GateFinding[] =
                result?.gate.findings ??
                ((variant.gate_result as { findings?: GateFinding[] } | null)?.findings ?? []);
              const blocking = primaryRemedy(findings);
              return (
                <div key={variant.id} className="rounded-md border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {variant.platform} · {variant.format}
                    </span>
                    {variant.overridden_by ? (
                      <Badge tone="amber">
                        {fillCopy(copy.variant_overridden, { who: variant.overridden_by })}
                      </Badge>
                    ) : (
                      <Badge tone={findings.some((f) => f.status === 'failed') ? 'red' : 'green'}>
                        {findings.some((f) => f.status === 'failed')
                          ? copy.gate_blocked
                          : copy.gate_passed}
                      </Badge>
                    )}
                  </div>

                  <GateBody content={variant.content} findings={findings} copy={copy} />

                  {blocking && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {blocking.remedy === 'add_proof' ? (
                        <Link
                          href="/product"
                          className="rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
                        >
                          {copy.remedies.add_proof}
                        </Link>
                      ) : (
                        <Badge tone="amber">
                          {blocking.remedy ? copy.remedies[blocking.remedy] : ''}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setOverrideFor(variant.id);
                          setOverrideReason('');
                        }}
                      >
                        {copy.override_button}
                      </Button>
                    </div>
                  )}

                  {overrideFor === variant.id && (
                    <div className="mt-3 rounded-md bg-amber-50 p-3">
                      <p className="text-xs text-amber-900">{copy.override_hint}</p>
                      <textarea
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        placeholder={copy.override_placeholder}
                        rows={3}
                        className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={overrideReason.trim().length < 10}
                          onClick={() => submitOverride(detail.item.id, variant.id)}
                        >
                          {copy.override_confirm}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setOverrideFor(null)}>
                          {copy.override_cancel}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function CountPill({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'amber' | 'teal' | 'red' | 'gray';
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <Badge tone={tone}>{value}</Badge>
      <span className="text-gray-600">{label}</span>
    </span>
  );
}

/** Markiert die auslösende Textstelle inline — `span` aus Vertrag C4. */
function GateBody({
  content,
  findings,
  copy,
}: {
  content: string;
  findings: GateFinding[];
  copy: PipelineCopy;
}) {
  const failing = findings.find((entry) => entry.status === 'failed' && entry.span);
  const parts = splitBySpan(content, failing?.span ?? null);

  return (
    <div className="mt-3 space-y-3">
      <p className="whitespace-pre-wrap text-sm text-gray-700">
        {parts.before}
        {parts.marked && (
          <mark className="rounded bg-red-100 px-0.5 text-red-900">{parts.marked}</mark>
        )}
        {parts.after}
      </p>
      <ul className="space-y-1">
        {findings.map((finding) => (
          <li key={finding.check} className="flex items-start gap-2 text-xs">
            <Badge tone={findingTone(finding)}>{copy.checks[finding.check]}</Badge>
            <span className="text-gray-600">
              {finding.message}
              {finding.status === 'skipped' && (
                <span className="ml-1 italic text-gray-500">({copy.gate_skipped_note})</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
