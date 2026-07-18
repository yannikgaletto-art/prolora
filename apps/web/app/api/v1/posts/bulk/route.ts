import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPostSchema, type CreatePostRequest } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError, ApiError } from '@/lib/api/http';
import { createPost } from '@/lib/posts/create-post';
import { CONNECTION_ROW_COLUMNS, getServiceDb, type ConnectionRow } from '@/lib/db';

const MAX_BULK_POSTS = 100;

const bulkJsonSchema = z.object({
  posts: z.array(createPostSchema).min(1).max(MAX_BULK_POSTS),
});

interface BulkItemResult {
  index: number;
  post_group_id?: string;
  status?: string;
  error?: string;
}

// POST /api/v1/posts/bulk — JSON ({ posts: [...] }) or CSV upload.
// Posts are created sequentially; publish throttling happens in Inngest
// (per-connection concurrency), not here.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const contentType = req.headers.get('content-type') ?? '';

    let requests: CreatePostRequest[];
    if (contentType.includes('multipart/form-data')) {
      requests = await parseCsvUpload(req, workspaceId);
    } else {
      const body: unknown = await req.json().catch(() => null);
      if (body === null) {
        return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
      }
      requests = bulkJsonSchema.parse(body).posts;
    }

    if (requests.length > MAX_BULK_POSTS) {
      return jsonError(400, `Maximum ${MAX_BULK_POSTS} posts per bulk request.`, 'too_many_posts');
    }

    const items: BulkItemResult[] = [];
    let created = 0;

    for (let index = 0; index < requests.length; index++) {
      try {
        const { response } = await createPost(workspaceId, requests[index], 'api');
        items.push({ index, post_group_id: response.post_group_id, status: 'queued' });
        created++;
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join('; ')
              : 'Internal error while creating this post';
        if (!(error instanceof ApiError) && !(error instanceof z.ZodError)) {
          console.error(`[bulk] post ${index} failed:`, error);
        }
        items.push({ index, error: message });
      }
    }

    return NextResponse.json({
      total: requests.length,
      created,
      failed: requests.length - created,
      items,
    });
  } catch (error) {
    return handleRouteError('v1/posts/bulk POST', error);
  }
}

// CSV format (FABLE-02 Abschnitt 10):
//   content,platforms,scheduled_at,adapt_content
//   "Mein Post",linkedin|x,2026-07-15T10:00:00Z,true
// platforms may be platform names (resolved to the workspace's single
// active connection of that platform) or connection UUIDs.
async function parseCsvUpload(req: NextRequest, workspaceId: string): Promise<CreatePostRequest[]> {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    throw new ApiError(400, 'multipart upload requires a "file" field with the CSV.', 'missing_file');
  }
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new ApiError(400, 'CSV must contain a header row and at least one post.', 'empty_csv');
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  if (col('content') === -1 || col('platforms') === -1) {
    throw new ApiError(400, 'CSV header must contain "content" and "platforms".', 'invalid_csv');
  }

  const connectionsByPlatform = await loadConnectionsByPlatform(workspaceId);

  return rows.slice(1).map((row, rowIndex) => {
    const content = row[col('content')] ?? '';
    const platformsRaw = row[col('platforms')] ?? '';
    const scheduledAt = col('scheduled_at') >= 0 ? row[col('scheduled_at')]?.trim() : undefined;
    const adaptContent = col('adapt_content') >= 0 ? row[col('adapt_content')]?.trim() : undefined;

    const platforms = platformsRaw
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => resolvePlatformToken(p, connectionsByPlatform, rowIndex));

    return {
      content,
      platforms,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(adaptContent ? { adapt_content: adaptContent.toLowerCase() === 'true' } : {}),
    };
  });
}

function resolvePlatformToken(
  token: string,
  connectionsByPlatform: Map<string, ConnectionRow[]>,
  rowIndex: number
): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return token; // already a connection UUID
  }
  const matches = connectionsByPlatform.get(token.toLowerCase()) ?? [];
  if (matches.length === 0) {
    throw new ApiError(
      400,
      `CSV row ${rowIndex + 1}: no active ${token} connection in this workspace.`,
      'unknown_platform'
    );
  }
  if (matches.length > 1) {
    throw new ApiError(
      400,
      `CSV row ${rowIndex + 1}: multiple ${token} connections — use the connection UUID instead.`,
      'ambiguous_platform'
    );
  }
  return matches[0].id;
}

async function loadConnectionsByPlatform(workspaceId: string): Promise<Map<string, ConnectionRow[]>> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .returns<ConnectionRow[]>();
  if (error) {
    throw new Error(`[bulk] connections lookup failed: ${error.message}`);
  }
  const map = new Map<string, ConnectionRow[]>();
  for (const connection of data ?? []) {
    const list = map.get(connection.platform) ?? [];
    list.push(connection);
    map.set(connection.platform, list);
  }
  return map;
}

// Minimal CSV parser: quoted fields, escaped quotes (""), CRLF/LF rows.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  return rows;
}
