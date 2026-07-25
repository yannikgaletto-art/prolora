import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { listDiscoveryProviderStatuses } from '@/lib/discovery/providers';

// GET /api/v1/integrations — availability of every discovery provider, in
// picker order (credential-free first). The Discover client island needs all of
// them at once; fetching them one by one would make the first paint depend on
// the slowest provider check.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const providers = await listDiscoveryProviderStatuses(workspaceId);
    return NextResponse.json({ providers });
  } catch (error) {
    return handleRouteError('v1/integrations GET', error);
  }
}
