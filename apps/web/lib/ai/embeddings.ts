// Embedding provider for pgvector duplicate detection (VECTOR(1536)).
// Anthropic offers no embedding API — supported providers, in order:
//   1. VOYAGE_API_KEY  -> voyage-large-2 (1536 dims)
//   2. OPENAI_API_KEY  -> text-embedding-3-small (1536 dims)
// Without a key: returns null and the caller skips duplicate detection.
// Feedback ingestion NEVER fails over embeddings (Invariante 4).

const EXPECTED_DIMENSIONS = 1536;
let warnedNoProvider = false;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const input = text.slice(0, 8000); // both providers cap input length

  try {
    if (process.env.VOYAGE_API_KEY) {
      return await voyageEmbedding(input);
    }
    if (process.env.OPENAI_API_KEY) {
      return await openAiEmbedding(input);
    }
  } catch (error) {
    console.error('[embeddings] generation failed — duplicate check skipped:', error);
    return null;
  }

  if (!warnedNoProvider) {
    warnedNoProvider = true;
    console.warn(
      '[embeddings] no VOYAGE_API_KEY/OPENAI_API_KEY configured — feedback duplicate detection is disabled'
    );
  }
  return null;
}

async function voyageEmbedding(input: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: 'voyage-large-2', input: [input] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Voyage embeddings returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return validateDimensions(json.data?.[0]?.embedding);
}

async function openAiEmbedding(input: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI embeddings returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return validateDimensions(json.data?.[0]?.embedding);
}

function validateDimensions(embedding: number[] | undefined): number[] {
  if (!embedding || embedding.length !== EXPECTED_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding?.length ?? 0} dimensions, schema expects ${EXPECTED_DIMENSIONS}`
    );
  }
  return embedding;
}
