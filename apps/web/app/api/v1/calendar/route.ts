import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getCalendar, validateCalendarRange } from '@/lib/posts/calendar';

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// GET /api/v1/calendar?from=<UTC ISO>&to=<UTC ISO> — bounded range read keyed
// on scheduled_at, plus the unscheduled-drafts rail (GOAL-RUN6 Phase 2).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { from, to } = querySchema.parse({
      from: req.nextUrl.searchParams.get('from'),
      to: req.nextUrl.searchParams.get('to'),
    });

    const rangeError = validateCalendarRange(from, to);
    if (rangeError) {
      return jsonError(400, rangeError, 'invalid_range');
    }

    const calendar = await getCalendar(workspaceId, from, to);
    return NextResponse.json(calendar);
  } catch (error) {
    return handleRouteError('v1/calendar GET', error);
  }
}
