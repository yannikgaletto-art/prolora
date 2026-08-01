import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { ApiError } from '@/lib/api/http';
import { parseGoldenSampleBundle } from './golden-bundle';

const FILES = [
  'polarisierung.md',
  'inside-the-room.md',
  'failure-und-learning.md',
  'mission-und-gemeinwohl.md',
] as const;

export interface GoldenSampleSourceFile { sourceFile: string; markdown: string }

export async function loadCuratedGoldenSampleFiles(): Promise<GoldenSampleSourceFile[]> {
  const candidates = [
    resolve(process.cwd(), 'golden-samples'),
    resolve(process.cwd(), '../../golden-samples'),
  ];
  const directory = candidates.find((candidate) => existsSync(candidate));
  if (!directory) throw new Error('[writer] curated Golden Sample bundle is missing');
  return Promise.all(FILES.map(async (sourceFile) => ({
    sourceFile,
    markdown: await readFile(resolve(directory, sourceFile), 'utf8'),
  })));
}

export async function importGoldenSampleBundle(
  workspaceId: string,
  files: readonly GoldenSampleSourceFile[],
  bundleVersion: string
): Promise<{ imported: number; samples: unknown[] }> {
  const samples = files.flatMap((file) =>
    parseGoldenSampleBundle(file.markdown, file.sourceFile, bundleVersion)
  );
  if (samples.length !== 12) {
    throw new Error(`[writer] curated bundle must contain 12 samples, found ${samples.length}`);
  }
  const payload = samples.map((sample) => ({
    platform: sample.platform,
    content: sample.content,
    category: sample.category,
    hookType: sample.hookType,
    contentFormat: sample.contentFormat,
    maskedContent: sample.maskedContent,
    contentHash: sample.contentHash,
    metadata: {
      bundleKey: sample.bundleKey,
      bundleVersion: sample.bundleVersion,
      language: sample.language,
      sourceFile: sample.sourceFile,
      maskedContentHash: sample.maskedContentHash,
    },
  }));
  const { data, error } = await getServiceDb().rpc('import_content_sample_bundle_atomic', {
    p_workspace_id: workspaceId,
    p_samples: payload,
  });
  if (error) {
    if (isMissingSchemaError(error.code) || error.code === 'PGRST202') {
      throw new ApiError(503, 'Golden Sample import requires migration 023.', 'migration_pending');
    }
    throw new Error(`[writer] Golden Sample import failed: ${error.message}`);
  }
  return { imported: samples.length, samples: Array.isArray(data) ? data : [] };
}
