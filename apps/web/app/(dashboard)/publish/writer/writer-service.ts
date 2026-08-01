import 'server-only';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import {
  DEFAULT_WRITER_POLICY,
  EMPTY_WRITER_DNA,
  dnaConfidenceTier,
  type WriterChannelPreview,
  type WriterDna,
  type WriterDnaSample,
  type WriterHistoryEntry,
  type WriterMedia,
  type WriterReview,
  type WriterUiData,
} from './writer-model';

interface PolicyRow {
  enabled: boolean;
  mode: string;
  daily_post_cap: number;
  weekly_credit_cap: number;
  timezone: string;
}

interface DnaRow {
  version: number;
  status: WriterDna['status'];
  profile: unknown;
  confidence: unknown;
  locked_rules: unknown;
  sample_count: number;
}

interface SampleRow {
  id: string;
  kind: 'golden' | 'avoid';
  origin: 'pasted' | 'imported' | 'published';
  platform: string | null;
  label: string | null;
  active: boolean;
}

interface ReviewRow {
  id: string;
  status: WriterHistoryEntry['status'];
  snapshot: unknown;
  snapshot_hash: string;
  dna_version: number | null;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

interface ContentItemStatusRow {
  id: string;
  state: string;
}

interface QueryResult<T> {
  data: T | null;
  error: { code?: string | null; message?: string | null } | null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function parseMedia(value: unknown): WriterMedia[] {
  return records(value).map((entry, index) => ({
    type:
      entry.type === 'video' || entry.type === 'document'
        ? entry.type
        : 'image',
    label: text(
      entry.label,
      text(entry.filename, text(entry.storageKey, `Media ${index + 1}`))
    ),
    altText: text(entry.alt_text, text(entry.altText)) || null,
  }));
}

function parseChannels(snapshot: Record<string, unknown>): WriterChannelPreview[] {
  const rawChannels = records(snapshot.channels ?? snapshot.variants);
  return rawChannels.map((entry, index) => {
    const connection = record(entry.connection);
    return {
      id: text(entry.id, text(entry.variant_id, `channel-${index + 1}`)),
      platform: text(entry.platform, text(connection.platform, 'channel')),
      accountName: text(
        entry.account_name,
        text(
          entry.accountName,
          text(connection.accountName, text(entry.connection_name, 'Connected account'))
        )
      ),
      format:
        entry.format === 'thread' || entry.format === 'article'
          ? entry.format
          : 'post',
      content: text(entry.content, text(entry.resolved_content)),
      segments: stringList(entry.segments),
      media: parseMedia(entry.media),
      firstComment: text(entry.first_comment, text(entry.firstComment)) || null,
      gatePassed: entry.gate_passed !== false && entry.gatePassed !== false,
    };
  });
}

function formatLocalSchedule(isoDate: string, timezone: string): string {
  const date = new Date(isoDate);
  if (!isoDate || Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(date);
  } catch {
    return isoDate;
  }
}

function parseReview(row: ReviewRow): WriterReview {
  const snapshot = record(row.snapshot);
  const schedule = record(snapshot.schedule ?? snapshot.proposed_slot);
  const contentItem = record(snapshot.contentItem ?? snapshot.content_item);
  const sources = record(snapshot.sources);
  const explicitClaims = records(snapshot.claims).map((claim) => ({
    text: text(claim.text, text(claim.claim)),
    sourceLabel: text(claim.source_label, text(claim.sourceLabel, text(claim.source))),
    sourceUrl: text(claim.source_url, text(claim.sourceUrl)) || null,
    verified: claim.verified === true,
  }));
  const proofClaims = records(sources.proofAssets ?? sources.proof_assets).map((proof) => ({
    text: 'Consent-aware proof asset',
    sourceLabel: text(proof.label, text(proof.id, 'Proof asset')),
    sourceUrl: null,
    verified: Boolean(proof.verifiedAt ?? proof.verified_at),
  }));
  const feedbackClaims = stringList(
    sources.feedbackItemIds ?? sources.feedback_item_ids
  ).map((id) => ({
    text: 'Linked feedback signal',
    sourceLabel: id,
    sourceUrl: null,
    verified: false,
  }));
  const referenceClaims = stringList(sources.referenceIds ?? sources.reference_ids).map(
    (id) => ({
      text: 'Linked reference',
      sourceLabel: id,
      sourceUrl: null,
      verified: false,
    })
  );
  const claims = [...explicitClaims, ...proofClaims, ...feedbackClaims, ...referenceClaims];
  const warnings = stringList(snapshot.warnings);
  const variantFindings = records(snapshot.variants).flatMap((variant) =>
    records(record(variant.gateResult ?? variant.gate_result).findings)
  );
  const gateFindings = variantFindings.map((finding) =>
    `${text(finding.status, 'unknown')}: ${text(finding.message, text(finding.check))}`
  );
  warnings.push(...variantFindings
    .filter((finding) => finding.status === 'failed')
    .map((finding) => text(finding.message, text(finding.check)))
    .filter(Boolean));
  const skippedChecks = [
    ...stringList(snapshot.skipped_checks ?? snapshot.skippedChecks),
    ...variantFindings
      .filter((finding) => finding.status === 'skipped')
      .map((finding) => text(finding.message, text(finding.check)))
      .filter(Boolean),
  ];
  const generationContexts = records(record(snapshot.generation).contexts);
  const factBindings = [...new Set(generationContexts.flatMap((entry) => stringList(entry.factIds ?? entry.fact_ids)))];
  const sampleBindings = [...new Set(generationContexts.flatMap((entry) => stringList(entry.sampleIds ?? entry.sample_ids)))];
  const mentionDecisions = generationContexts.map((entry) => {
    const mention = record(entry.mention);
    return `${text(entry.platform, 'channel')}: ${text(mention.decision, 'unknown')} — ${text(mention.reason, 'no reason')}`;
  });
  const overrides = stringList(snapshot.overrides);
  const channels = parseChannels(snapshot);
  const timezone = text(
    schedule.timezone,
    text(snapshot.timezone, DEFAULT_WRITER_POLICY.timezone)
  );
  const proposedUtcTime = text(
    schedule.scheduledAt,
    text(
      schedule.scheduled_at,
      text(schedule.utc_time, text(schedule.utcTime, text(snapshot.proposed_utc_time)))
    )
  );

  return {
    id: row.id,
    snapshotHash: row.snapshot_hash,
    title: text(snapshot.title, text(contentItem.title, 'Writer recommendation')),
    preview: text(
      snapshot.preview,
      text(contentItem.canonicalContent, text(contentItem.canonical_content, channels[0]?.content ?? ''))
    ),
    whyNow: text(snapshot.why_now, text(snapshot.whyNow, '')),
    proposedLocalTime: text(
      schedule.local_time,
      text(
        schedule.localTime,
        text(snapshot.proposed_local_time, formatLocalSchedule(proposedUtcTime, timezone))
      )
    ),
    timezone,
    proposedUtcTime,
    dnaVersion: row.dna_version,
    dnaSampleCount: numberValue(snapshot.dna_sample_count),
    sourceCount: numberValue(snapshot.source_count, claims.length),
    warnings,
    skippedChecks,
    gateFindings,
    factBindings,
    sampleBindings,
    mentionDecisions,
    overrides,
    changes: stringList(snapshot.changes),
    claims,
    channels,
  };
}

function profileTraits(profile: unknown): string[] {
  const value = record(profile);
  const explicit = stringList(value.traits);
  if (explicit.length > 0) return explicit;

  const traits: string[] = [];
  const openings = stringList(value.commonOpeningShapes ?? value.common_opening_shapes);
  if (openings.length > 0) traits.push(`Openings: ${openings.join(', ')}`);
  const sentenceLength = numberValue(value.medianSentenceLength ?? value.median_sentence_length);
  if (sentenceLength > 0) traits.push(`Median sentence: ${sentenceLength} words`);
  const paragraphLength = numberValue(value.medianParagraphLength ?? value.median_paragraph_length);
  if (paragraphLength > 0) traits.push(`Median paragraph: ${paragraphLength} words`);
  if (numberValue(value.preferredWhitespaceDensity ?? value.preferred_whitespace_density) >= 0.15) {
    traits.push('Generous whitespace between ideas');
  }
  return traits;
}

function lockedRuleLabels(value: unknown): string[] {
  return records(value)
    .filter((rule) => rule.locked !== false)
    .map((rule) => text(rule.instruction, text(rule.label)))
    .filter(Boolean);
}

function errorState(
  results: Array<QueryResult<unknown>>
): 'migration_pending' | 'unavailable' | null {
  const errors = results.map((result) => result.error).filter(Boolean);
  if (errors.some((error) => isMissingSchemaError(error?.code))) return 'migration_pending';
  return errors.length > 0 ? 'unavailable' : null;
}

function historyEntry(row: ReviewRow): WriterHistoryEntry {
  const snapshot = record(row.snapshot);
  const timestamp = row.approved_at ?? row.rejected_at ?? row.created_at;
  return {
    id: row.id,
    title: text(snapshot.title, 'Writer recommendation'),
    status: row.status,
    occurredAt: timestamp,
    detail:
      row.rejection_reason ??
      text(snapshot.history_detail, text(snapshot.why_now, 'Review snapshot recorded')),
  };
}

export async function loadWriterUiData(
  workspaceId: string,
  workspaceName: string
): Promise<WriterUiData> {
  const db = getServiceDb();
  const [policyResult, dnaResult, samplesResult, pendingResult, historyResult, itemsResult] =
    await Promise.all([
      db
        .from('workspace_writer_policies')
        .select('enabled, mode, daily_post_cap, weekly_credit_cap, timezone')
        .eq('workspace_id', workspaceId)
        .maybeSingle<PolicyRow>(),
      db
        .from('content_dna_profiles')
        .select('version, status, profile, confidence, locked_rules, sample_count')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle<DnaRow>(),
      db
        .from('content_samples')
        .select('id, kind, origin, platform, label, active')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<SampleRow[]>(),
      db
        .from('writer_review_bundles')
        .select(
          'id, status, snapshot, snapshot_hash, dna_version, created_at, approved_at, rejected_at, rejection_reason'
        )
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<ReviewRow>(),
      db
        .from('writer_review_bundles')
        .select(
          'id, status, snapshot, snapshot_hash, dna_version, created_at, approved_at, rejected_at, rejection_reason'
        )
        .eq('workspace_id', workspaceId)
        .in('status', ['approved', 'rejected', 'invalidated', 'expired'])
        .order('created_at', { ascending: false })
        .limit(30)
        .returns<ReviewRow[]>(),
      db
        .from('content_items')
        .select('id, state')
        .eq('workspace_id', workspaceId)
        .in('state', ['signal', 'angled', 'concepted', 'drafted', 'gated', 'awaiting_approval'])
        .limit(200)
        .returns<ContentItemStatusRow[]>(),
    ]);

  const availabilityError = errorState([
    policyResult,
    dnaResult,
    samplesResult,
    pendingResult,
    historyResult,
    itemsResult,
  ]);
  const samples: WriterDnaSample[] = (samplesResult.data ?? []).map((sample) => ({
    id: sample.id,
    kind: sample.kind,
    origin: sample.origin,
    label: sample.label ?? 'Untitled sample',
    platform: sample.platform,
    active: sample.active,
  }));
  const goldenSampleCount = samples.filter(
    (sample) => sample.active && sample.kind === 'golden'
  ).length;
  const avoidSampleCount = samples.filter(
    (sample) => sample.active && sample.kind === 'avoid'
  ).length;
  const dnaRow = dnaResult.data;
  const dna: WriterDna = dnaRow
    ? {
        version: dnaRow.version,
        status: dnaRow.status,
        sampleCount: dnaRow.sample_count,
        goldenSampleCount,
        avoidSampleCount,
        confidence: dnaConfidenceTier(goldenSampleCount),
        traits: profileTraits(dnaRow.profile),
        lockedRules: lockedRuleLabels(dnaRow.locked_rules),
        samples,
      }
    : {
        ...EMPTY_WRITER_DNA,
        sampleCount: samples.filter((sample) => sample.active).length,
        goldenSampleCount,
        avoidSampleCount,
        confidence: dnaConfidenceTier(goldenSampleCount),
        samples,
      };
  const policyRow = policyResult.data;
  const policy = policyRow
    ? {
        enabled: policyRow.enabled,
        mode: 'approval_required' as const,
        dailyPostCap: policyRow.daily_post_cap,
        weeklyCreditCap: policyRow.weekly_credit_cap,
        timezone: policyRow.timezone,
      }
    : DEFAULT_WRITER_POLICY;
  const items = itemsResult.data ?? [];
  const history = (historyResult.data ?? []).map(historyEntry);

  return {
    availability:
      availabilityError ??
      (dna.status !== 'active' || goldenSampleCount < 3 ? 'setup' : 'ready'),
    workspaceName,
    policy,
    stats: {
      awaitingApproval: pendingResult.data ? 1 : 0,
      preparing: items.filter((item) => item.state !== 'awaiting_approval').length,
      goldenSamples: goldenSampleCount,
      exceptions: history.filter((entry) =>
        ['invalidated', 'expired'].includes(entry.status)
      ).length,
    },
    dna,
    pendingReview: pendingResult.data ? parseReview(pendingResult.data) : null,
    history,
  };
}
