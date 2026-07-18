import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError } from '@/lib/api/http';
import { getServiceDb, type ContentSourceRow } from '@/lib/db';
import { assertPublicHttpUrl } from '@/lib/security/ssrf';

// Pillar sources for the splinter engine (GOAL-RUN6 §12).
// POST: save a pillar (pasted/dictated text, or import a blog URL).
// GET:  list the workspace's pillars, newest first.

const createSchema = z
  .object({
    kind: z.enum(['paste', 'url']),
    title: z.string().max(300).optional(),
    body_md: z.string().max(60_000).optional(),
    url: z.string().max(2000).optional(),
  })
  .refine((b) => (b.kind === 'paste' ? Boolean(b.body_md?.trim()) : Boolean(b.url?.trim())), {
    message: 'paste requires body_md, url requires url',
  });

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 40_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body = createSchema.parse(await req.json());

    let title = body.title?.trim() || null;
    let bodyMd = body.body_md?.trim() ?? '';
    let sourceUrl: string | null = null;

    if (body.kind === 'url') {
      const url = assertPublicHttpUrl(body.url!.trim());
      sourceUrl = url.toString();
      const imported = await importArticle(url);
      bodyMd = imported.text;
      title = title ?? imported.title;
    }

    if (bodyMd.length < 200) {
      throw new ApiError(
        400,
        'The pillar text is too short to be useful (min. 200 characters).',
        'pillar_too_short'
      );
    }

    const db = getServiceDb();
    const { data, error } = await db
      .from('content_sources')
      .insert({
        workspace_id: workspaceId,
        kind: body.kind,
        title,
        body_md: bodyMd,
        source_url: sourceUrl,
      })
      .select('*')
      .single<ContentSourceRow>();
    if (error || !data) {
      throw new Error(`[content-sources] insert failed: ${error?.message ?? 'no row'}`);
    }

    return NextResponse.json({ source: toDto(data) }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/content/sources POST', error);
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();
    const { data, error } = await db
      .from('content_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(50)
      .returns<ContentSourceRow[]>();
    if (error) {
      throw new Error(`[content-sources] list failed: ${error.message}`);
    }
    return NextResponse.json({ sources: (data ?? []).map(toDto) });
  } catch (error) {
    return handleRouteError('v1/content/sources GET', error);
  }
}

function toDto(row: ContentSourceRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    source_url: row.source_url,
    status: row.status,
    body_preview: row.body_md.length > 240 ? `${row.body_md.slice(0, 240)}…` : row.body_md,
    body_chars: row.body_md.length,
    splinter_count: Array.isArray(row.splinters) ? row.splinters.length : 0,
    splintered_at: row.splintered_at,
    created_at: row.created_at,
  };
}

// Naive readability: strip scripts/styles/tags, collapse whitespace. Good
// enough for blog posts; a real extraction lib is a later upgrade (and a new
// dependency, which needs a check-in per CLAUDE.md).
async function importArticle(url: URL): Promise<{ title: string | null; text: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Prolora/1.0 (+https://prolora.eu) content-import' },
      redirect: 'follow',
    });
  } catch {
    throw new ApiError(502, 'Could not fetch that URL.', 'import_failed');
  }
  if (!response.ok) {
    throw new ApiError(502, `The page answered with HTTP ${response.status}.`, 'import_failed');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new ApiError(400, 'Only HTML or plain-text pages can be imported.', 'import_failed');
  }

  const raw = await response.text();
  const html = raw.length > MAX_IMPORT_BYTES ? raw.slice(0, MAX_IMPORT_BYTES) : raw;

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 300) || null : null;

  // Prefer <article> content when present.
  const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  const scope = articleMatch ? articleMatch[1] : html;

  const text = decodeEntities(
    scope
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);

  return { title, text };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
}
