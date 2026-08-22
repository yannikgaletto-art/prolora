import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { getServiceDb, type RawFeedbackRow } from '@/lib/db';
import { analyzeFeedback } from '@/lib/ai/analyze-feedback';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { CREDIT_COSTS, type FeedbackAnalysis } from '@prolora/shared';
import { isAutomationEnabled } from '@/lib/system/kill-switch';

const DUPLICATE_THRESHOLD = 0.92;

export const processFeedback = inngest.createFunction(
  {
    id: 'process-feedback',
    retries: 3,
    concurrency: [{ limit: 3, key: 'event.data.workspaceId' }],
  },
  { event: 'feedback/process' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { skipped: true, reason: 'automation disabled' };

    const { rawFeedbackId, workspaceId } = event.data;

    // 1. Load the raw feedback — it is ALREADY durable (Invariante 4).
    const raw = await step.run('load-raw-feedback', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('raw_feedback')
        .select('*')
        .eq('id', rawFeedbackId)
        .eq('workspace_id', workspaceId)
        .maybeSingle<RawFeedbackRow>();
      if (error) throw new Error(`[process-feedback] load failed: ${error.message}`);
      if (!data) throw new NonRetriableError(`raw_feedback ${rawFeedbackId} not found`);
      return data;
    });

    if (raw.processed) {
      return { processed: false, reason: 'already processed' };
    }

    // 2. LLM analysis (tool-use). null after 2 attempts -> save WITHOUT
    //    analysis rather than losing the feedback (R3 fallback).
    const analysisResult = await step.run('analyze-with-llm', async () => {
      return analyzeFeedback(raw.content, {
        platform: raw.source_platform,
        rating: raw.rating,
        author: raw.author_name,
      });
    });

    // 3. Embedding + duplicate check (cosine similarity > 0.92 via
    //    match_feedback_embeddings). Both are best-effort.
    const duplicateCheck = await step.run('check-duplicates', async () => {
      const embedding = await generateEmbedding(raw.content);
      if (!embedding) {
        return { embedding: null, duplicateOf: null };
      }

      const db = getServiceDb();
      const { data, error } = await db.rpc('match_feedback_embeddings', {
        query_embedding: JSON.stringify(embedding),
        match_workspace_id: workspaceId,
        match_threshold: DUPLICATE_THRESHOLD,
        match_count: 1,
      });
      if (error) {
        console.error('[process-feedback] duplicate check failed:', error.message);
        return { embedding, duplicateOf: null };
      }
      const matches = (data ?? []) as Array<{ id: string; similarity: number }>;
      return { embedding, duplicateOf: matches[0]?.id ?? null };
    });

    // 4. Persist feedback_item + mark raw as processed (Double Assurance).
    const saved = await step.run('save-feedback-item', async () => {
      const db = getServiceDb();
      const analysis: FeedbackAnalysis | null = analysisResult?.analysis ?? null;

      const { data: inserted, error } = await db
        .from('feedback_items')
        .insert({
          workspace_id: workspaceId,
          source_platform: raw.source_platform,
          source_url: raw.source_url,
          source_author: raw.author_name,
          source_author_avatar: raw.author_avatar,
          source_date: raw.source_date,
          original_content: raw.content,
          original_language: analysis?.language ?? null,
          rating: raw.rating,
          sentiment: analysis?.sentiment ?? null,
          sentiment_score: analysis?.sentiment_score ?? null,
          category: analysis?.category ?? (analysis === null ? 'other' : null),
          summary_de: analysis?.summary_de ?? null,
          summary_en: analysis?.summary_en ?? null,
          topics: analysis?.topics ?? [],
          urgency: analysis?.urgency ?? null,
          actionable: analysis?.actionable ?? false,
          suggested_action: analysis?.suggested_action ?? null,
          is_duplicate: duplicateCheck.duplicateOf !== null,
          duplicate_of: duplicateCheck.duplicateOf,
          embedding: duplicateCheck.embedding ? JSON.stringify(duplicateCheck.embedding) : null,
          status: 'new',
        })
        .select('id')
        .single<{ id: string }>();
      if (error || !inserted) {
        throw new Error(`[process-feedback] insert failed: ${error?.message ?? 'no row'}`);
      }

      const { error: markError } = await db
        .from('raw_feedback')
        .update({ processed: true })
        .eq('id', raw.id);
      if (markError) {
        throw new Error(`[process-feedback] processed flag failed: ${markError.message}`);
      }

      // Read-back: item exists AND raw is flagged.
      const { data: verify, error: verifyError } = await db
        .from('feedback_items')
        .select('id')
        .eq('id', inserted.id)
        .single<{ id: string }>();
      if (verifyError || !verify) {
        throw new Error('[process-feedback] write verification failed');
      }

      if (analysisResult) {
        const { error: usageError } = await db.from('usage_logs').insert({
          workspace_id: workspaceId,
          action: 'feedback_analysis',
          credits_used: CREDIT_COSTS.feedback_analysis,
          metadata: {
            feedback_item_id: inserted.id,
            input_tokens: analysisResult.inputTokens,
            output_tokens: analysisResult.outputTokens,
          },
        });
        if (usageError) {
          console.error('[process-feedback] usage log failed:', usageError.message);
        }
      }

      return { feedbackItemId: inserted.id, analyzed: analysisResult !== null };
    });

    // 5. Webhooks: always feedback.received; feedback.alert for critical
    //    urgency or strongly negative sentiment.
    const analysis = analysisResult?.analysis ?? null;
    const isAlert =
      analysis !== null && (analysis.urgency === 'critical' || analysis.sentiment_score < -0.7);

    await step.sendEvent('fire-feedback-webhooks', [
      {
        name: 'webhooks/fire' as const,
        data: {
          workspaceId,
          event: 'feedback.received',
          payload: {
            feedback_item_id: saved.feedbackItemId,
            source_platform: raw.source_platform,
            sentiment: analysis?.sentiment ?? null,
            category: analysis?.category ?? null,
            is_duplicate: duplicateCheck.duplicateOf !== null,
          },
        },
      },
      ...(isAlert
        ? [
            {
              name: 'webhooks/fire' as const,
              data: {
                workspaceId,
                event: 'feedback.alert',
                payload: {
                  feedback_item_id: saved.feedbackItemId,
                  source_platform: raw.source_platform,
                  urgency: analysis?.urgency ?? null,
                  sentiment_score: analysis?.sentiment_score ?? null,
                  summary_en: analysis?.summary_en ?? null,
                  suggested_action: analysis?.suggested_action ?? null,
                },
              },
            },
          ]
        : []),
    ]);

    return {
      processed: true,
      feedbackItemId: saved.feedbackItemId,
      analyzed: saved.analyzed,
      duplicate: duplicateCheck.duplicateOf !== null,
      alert: isAlert,
    };
  }
);

export const batchProcessFeedback = inngest.createFunction(
  {
    id: 'batch-process-feedback',
    retries: 1,
  },
  { event: 'feedback/batch-process' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { skipped: true, reason: 'automation disabled' };

    const { workspaceId, limit } = event.data;

    const unprocessed = await step.run('find-unprocessed', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('raw_feedback')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('processed', false)
        .order('ingested_at', { ascending: true })
        .limit(limit ?? 50)
        .returns<Array<Pick<RawFeedbackRow, 'id'>>>();
      if (error) throw new Error(`[batch-process] query failed: ${error.message}`);
      return (data ?? []).map((row) => row.id);
    });

    if (unprocessed.length > 0) {
      await step.sendEvent(
        'fan-out-processing',
        unprocessed.map((rawFeedbackId) => ({
          name: 'feedback/process' as const,
          data: { rawFeedbackId, workspaceId },
        }))
      );
    }

    return { queued: unprocessed.length };
  }
);
