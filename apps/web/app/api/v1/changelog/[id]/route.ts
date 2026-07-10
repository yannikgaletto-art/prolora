import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { updateChangelogEntry } from '@/lib/changelog/changelog-service';

const updateSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    content: z.string().min(1).optional(),
    related_board_items: z.array(z.string().uuid()).max(50).optional(),
    publish: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.content !== undefined ||
      v.related_board_items !== undefined ||
      v.publish !== undefined,
    { message: 'At least one of title, content, related_board_items, publish is required' }
  );

// PATCH /api/v1/changelog/[id] — AUTH, update and/or publish an entry.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'Invalid changelog entry id.', 'invalid_id');
    }

    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = updateSchema.parse(body);
    const entry = await updateChangelogEntry(workspaceId, id, input);

    return NextResponse.json({ entry });
  } catch (error) {
    return handleRouteError('v1/changelog PATCH', error);
  }
}
