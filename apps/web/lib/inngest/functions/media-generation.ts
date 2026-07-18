// AI media generation worker (spec section "Generation Worker"). Runs the
// OpenAI call outside the request lifecycle, revalidates the output, stores it
// in the PRIVATE media bucket, and settles the budget ledger. Idempotent: an
// already-completed generation is never submitted again.
import { inngest } from '@/lib/inngest/client';
import { getServiceDb, type MediaGenerationRow } from '@/lib/db';
import { MEDIA_BUCKET } from '@/lib/media/transform';
import { commitReservation, releaseReservation } from '@/lib/media/generation';

const IMAGE_SIZES: Record<MediaGenerationRow['format'], string> = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
};

const VIDEO_SIZES: Record<Exclude<MediaGenerationRow['format'], 'square'>, string> = {
  portrait: '720x1280',
  landscape: '1280x720',
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_POLL_ATTEMPTS = 30;
const VIDEO_POLL_SLEEP = '20s';

class TerminalGenerationError extends Error {}

export const generateMedia = inngest.createFunction(
  { id: 'media-generate', retries: 2, concurrency: [{ limit: 2, key: 'event.data.workspaceId' }] },
  { event: 'media/generate' },
  async ({ event, step }) => {
    const { generationId, workspaceId } = event.data;
    const db = getServiceDb();

    const row = await step.run('load', async () => {
      const { data, error } = await db
        .from('media_generations')
        .select('*')
        .eq('id', generationId)
        .eq('workspace_id', workspaceId)
        .maybeSingle<MediaGenerationRow>();
      if (error) throw new Error(`[media-gen:worker] load failed: ${error.message}`);
      return data;
    });
    if (!row) return { skipped: 'not_found' };
    // Idempotency: terminal states are never re-run (spec).
    if (row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled') {
      return { skipped: row.status };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await failGeneration(generationId, 'OPENAI_API_KEY missing at run time');
      return { failed: 'not_configured' };
    }

    await step.run('mark-running', async () => {
      await db.from('media_generations').update({ status: 'running' }).eq('id', generationId);
    });

    try {
      if (row.kind === 'image') {
        const bytes = await step.run('openai-image', () => generateImage(apiKey, row));
        await step.run('store', () => storeResult(row, Buffer.from(bytes, 'base64'), 'image/png'));
      } else {
        // sora-2: create job -> poll (durable sleeps) -> download MP4.
        const jobId = await step.run('sora-create', () => createVideoJob(apiKey, row));
        let completed = false;
        for (let i = 0; i < VIDEO_POLL_ATTEMPTS && !completed; i++) {
          await step.sleep(`sora-wait-${i}`, VIDEO_POLL_SLEEP);
          const status = await step.run(`sora-poll-${i}`, () => pollVideoJob(apiKey, jobId));
          if (status === 'completed') completed = true;
          if (status === 'failed') {
            throw new TerminalGenerationError('Provider reported the video job as failed.');
          }
        }
        if (!completed) {
          throw new TerminalGenerationError('Video generation timed out at the provider.');
        }
        const bytes = await step.run('sora-download', () => downloadVideo(apiKey, jobId));
        await step.run('store-video', () =>
          storeResult(row, Buffer.from(bytes, 'base64'), 'video/mp4')
        );
      }

      await step.run('finalize', async () => {
        await commitReservation(generationId);
      });
      return { succeeded: true };
    } catch (error) {
      // Terminal failures release the reservation (spec "Failure Handling");
      // transient errors are retried by Inngest before landing here.
      const message = error instanceof Error ? error.message : 'Unknown generation error';
      const terminal = error instanceof TerminalGenerationError;
      if (terminal) {
        await failGeneration(generationId, message);
        return { failed: message };
      }
      throw error; // let Inngest retry; final retry failure triggers onFailure below
    }
  }
);

async function failGeneration(generationId: string, message: string): Promise<void> {
  const db = getServiceDb();
  await db
    .from('media_generations')
    .update({
      status: 'failed',
      error_message: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq('id', generationId);
  await releaseReservation(generationId);
}

async function generateImage(apiKey: string, row: MediaGenerationRow): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: row.model,
      prompt: row.prompt,
      size: IMAGE_SIZES[row.format],
      n: 1,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 4xx = policy/input rejection -> terminal; 5xx/429 -> retryable.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new TerminalGenerationError(`Provider rejected the request (HTTP ${response.status}).`);
    }
    throw new Error(`[media-gen] image call failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new TerminalGenerationError('Provider returned no image data.');
  const size = Math.ceil((b64.length * 3) / 4);
  if (size > MAX_IMAGE_BYTES) {
    throw new TerminalGenerationError('Generated image exceeds the size limit.');
  }
  return b64;
}

async function createVideoJob(apiKey: string, row: MediaGenerationRow): Promise<string> {
  const size = VIDEO_SIZES[row.format as 'portrait' | 'landscape'];
  const response = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: row.model,
      prompt: row.prompt,
      seconds: '8', // fixed duration (spec)
      size,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new TerminalGenerationError(`Provider rejected the video request (HTTP ${response.status}).`);
    }
    throw new Error(`[media-gen] video create failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new TerminalGenerationError('Provider returned no video job id.');
  const db = getServiceDb();
  await db.from('media_generations').update({ provider_job_id: json.id }).eq('id', row.id);
  return json.id;
}

async function pollVideoJob(apiKey: string, jobId: string): Promise<'completed' | 'failed' | 'running'> {
  const response = await fetch(`https://api.openai.com/v1/videos/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return 'running'; // transient poll error — next tick retries
  const json = (await response.json()) as { status?: string };
  if (json.status === 'completed') return 'completed';
  if (json.status === 'failed') return 'failed';
  return 'running';
}

async function downloadVideo(apiKey: string, jobId: string): Promise<string> {
  const response = await fetch(`https://api.openai.com/v1/videos/${jobId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`[media-gen] video download failed: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_VIDEO_BYTES) {
    throw new TerminalGenerationError('Generated video exceeds the size limit.');
  }
  return bytes.toString('base64');
}

// Revalidate + store in the PRIVATE bucket under the obfuscated workspace path
// (spec "Media Storage"), then mark the row succeeded. Storage failure after
// provider success retries storage only (this step), not the provider job.
async function storeResult(
  row: MediaGenerationRow,
  bytes: Buffer,
  mimeType: 'image/png' | 'video/mp4'
): Promise<void> {
  if (bytes.length === 0) throw new TerminalGenerationError('Empty media payload.');
  const db = getServiceDb();
  const extension = mimeType === 'image/png' ? 'png' : 'mp4';
  const key = `workspaces/${row.workspace_id}/media/${row.id}/original.${extension}`;

  const { error: uploadError } = await db.storage.from(MEDIA_BUCKET).upload(key, bytes, {
    contentType: mimeType,
    upsert: true, // storage retry after provider success must not conflict
  });
  if (uploadError) {
    throw new Error(`[media-gen] storage upload failed: ${uploadError.message}`);
  }

  const { error: updateError } = await db
    .from('media_generations')
    .update({
      status: 'succeeded',
      storage_key: key,
      mime_type: mimeType,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', row.id);
  if (updateError) {
    throw new Error(`[media-gen] status update failed: ${updateError.message}`);
  }
}
