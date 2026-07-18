// GOAL-RUN8 T2.5: accuracy is always reported with sample size and prompt
// version data so model drift cannot masquerade as product truth.
import { getServiceDb, type ImpactPredictionRow } from '@/lib/db';

type TrafficLight = ImpactPredictionRow['traffic_light'];
type Bucket = Exclude<ImpactPredictionRow['outcome_bucket'], null>;

export interface ImpactAnalytics {
  evaluated: number;
  correct: number;
  accuracy: number | null;
  byPromptVersion: Record<number, { evaluated: number; correct: number }>;
  matrix: Record<TrafficLight, Record<Bucket, number>>;
}

export function isAccuratePrediction(light: TrafficLight, bucket: Bucket): boolean {
  if (light === 'green') return bucket === 'above' || bucket === 'outlier';
  if (light === 'yellow') return bucket === 'inline' || bucket === 'above';
  return bucket === 'below' || bucket === 'inline';
}

export async function getImpactAnalytics(workspaceId: string): Promise<ImpactAnalytics> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('impact_predictions')
    .select('traffic_light, outcome_bucket, prompt_version')
    .eq('workspace_id', workspaceId)
    .not('outcome_at', 'is', null)
    .not('outcome_bucket', 'is', null)
    .order('outcome_at', { ascending: false })
    .limit(1_000)
    .returns<Array<Pick<ImpactPredictionRow, 'traffic_light' | 'outcome_bucket' | 'prompt_version'>>>();
  if (error) throw new Error(`[impact] analytics lookup failed: ${error.message}`);

  const matrix = emptyMatrix();
  const byPromptVersion: Record<number, { evaluated: number; correct: number }> = {};
  let correct = 0;
  for (const row of data ?? []) {
    if (!row.outcome_bucket) continue;
    matrix[row.traffic_light][row.outcome_bucket] += 1;
    const hit = isAccuratePrediction(row.traffic_light, row.outcome_bucket);
    if (hit) correct += 1;
    const version = byPromptVersion[row.prompt_version] ?? { evaluated: 0, correct: 0 };
    version.evaluated += 1;
    if (hit) version.correct += 1;
    byPromptVersion[row.prompt_version] = version;
  }
  const evaluated = Object.values(byPromptVersion).reduce((sum, value) => sum + value.evaluated, 0);
  return {
    evaluated,
    correct,
    accuracy: evaluated > 0 ? correct / evaluated : null,
    byPromptVersion,
    matrix,
  };
}

function emptyMatrix(): ImpactAnalytics['matrix'] {
  const row = (): Record<Bucket, number> => ({ below: 0, inline: 0, above: 0, outlier: 0 });
  return { green: row(), yellow: row(), red: row() };
}
