import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';

const MAX_HTML_BYTES = 600_000;
const MAX_TEXT_CHARS = 12_000;

export interface WebsiteContext {
  product_description: string;
  target_audience: string;
  suggested_keywords: string[];
  voice_tone: string;
  voice_language: string;
  example_phrases: string[];
  confidence: number;
  inputTokens: number;
  outputTokens: number;
}

// Website -> product context: fetch, strip to text, tool-use extraction.
export async function extractWebsiteContext(websiteUrl: string): Promise<WebsiteContext> {
  const text = await fetchWebsiteText(websiteUrl);
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    system:
      'You analyze a product website and extract marketing context. ' +
      'Base EVERYTHING on the page text — never invent features. ' +
      'confidence reflects how clearly the page communicates what the product is (0.0-1.0). ' +
      'suggested_keywords: 5-12 search terms the target audience would actually type in communities.',
    messages: [
      {
        role: 'user',
        content: `Website: ${websiteUrl}\n\nPage text:\n${text}`,
      },
    ],
    tools: [
      {
        name: 'extract_website_context',
        description: 'Return the extracted product context',
        input_schema: {
          type: 'object' as const,
          properties: {
            product_description: { type: 'string', description: '2-3 sentences: what the product does' },
            target_audience: { type: 'string', description: 'Who buys/uses this (ICP)' },
            suggested_keywords: { type: 'array', items: { type: 'string' } },
            voice_tone: {
              type: 'string',
              enum: ['casual', 'professional', 'technical', 'empathetic'],
            },
            voice_language: { type: 'string', description: 'ISO 639-1 of the site language' },
            example_phrases: {
              type: 'array',
              items: { type: 'string' },
              description: '2-4 phrases capturing the brand voice',
            },
            confidence: { type: 'number' },
          },
          required: [
            'product_description',
            'target_audience',
            'suggested_keywords',
            'voice_tone',
            'voice_language',
            'example_phrases',
            'confidence',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_website_context' },
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('No tool_use block in extraction response');
  }
  const raw = block.input as Record<string, unknown>;

  return {
    product_description: typeof raw.product_description === 'string' ? raw.product_description : '',
    target_audience: typeof raw.target_audience === 'string' ? raw.target_audience : '',
    suggested_keywords: Array.isArray(raw.suggested_keywords)
      ? raw.suggested_keywords.filter((k): k is string => typeof k === 'string').slice(0, 12)
      : [],
    voice_tone: typeof raw.voice_tone === 'string' ? raw.voice_tone : 'casual',
    voice_language: typeof raw.voice_language === 'string' ? raw.voice_language.slice(0, 8) : 'de',
    example_phrases: Array.isArray(raw.example_phrases)
      ? raw.example_phrases.filter((p): p is string => typeof p === 'string').slice(0, 4)
      : [],
    confidence: Math.max(0, Math.min(1, typeof raw.confidence === 'number' ? raw.confidence : 0)),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// Fetch + reduce HTML to readable text (no external readability dependency).
async function fetchWebsiteText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Prolora/1.0 (website context extraction)' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Website returned HTTP ${response.status}`);
  }

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  const metaDescription =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h[1-6]|p|li|br|div|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  const combined = `TITLE: ${title}\nMETA: ${metaDescription}\n\n${text}`.slice(0, MAX_TEXT_CHARS);

  // JS-only SPAs render nothing server-side — fail loudly so the user can
  // enter the context manually instead of getting hallucinated garbage.
  if (text.length < 200) {
    throw new Error(
      'Website has too little readable text (JavaScript-only page?) — enter the product context manually'
    );
  }

  return combined;
}
