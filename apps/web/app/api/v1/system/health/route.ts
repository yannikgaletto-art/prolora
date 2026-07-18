import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getSystemStatus } from '@/lib/system/doctor';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    return NextResponse.json(await getSystemStatus(workspaceId));
  } catch (error) {
    return handleRouteError('v1/system/health GET', error);
  }
}
