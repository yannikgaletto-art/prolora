import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { buildGdprExport } from '@/lib/gdpr/export-service';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

// GET /api/v1/gdpr/export — workspace-scoped GDPR data export.
// Explicit column allowlists + serialized-payload secret scan live in
// lib/gdpr/export-service.ts. ?page=N applies to all tables (max 1000
// rows per table per page).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { page } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const { serialized, tableCount } = await buildGdprExport(workspaceId, page);

    console.log(`[gdpr] exported ${tableCount} tables for workspace ${workspaceId}`);
    return new NextResponse(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="prolora-export.json"',
      },
    });
  } catch (error) {
    return handleRouteError('v1/gdpr/export GET', error);
  }
}
