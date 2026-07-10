import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  createChangelogEntry,
  listPublicChangelog,
} from '@/lib/changelog/changelog-service';

const listQuerySchema = z.object({
  workspace: z.string().min(1, 'workspace slug is required'),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/v1/changelog?workspace={slug} — PUBLIC, published entries only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const { entries, total } = await listPublicChangelog(
      query.workspace,
      query.page,
      query.per_page
    );

    return NextResponse.json({
      entries,
      page: query.page,
      per_page: query.per_page,
      total,
    });
  } catch (error) {
    return handleRouteError('v1/changelog GET', error);
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1).optional(),
  related_board_items: z.array(z.string().uuid()).max(50).optional(),
  ai_draft: z.boolean().optional(),
  publish: z.boolean().optional(),
});

// POST /api/v1/changelog — AUTH, create an entry (optionally AI-drafted).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = createSchema.parse(body);
    const entry = await createChangelogEntry(workspaceId, input);

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/changelog POST', error);
  }
}
