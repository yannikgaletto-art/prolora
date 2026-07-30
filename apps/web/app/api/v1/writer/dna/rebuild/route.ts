import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { rebuildContentDna } from '@/lib/writer/samples';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const profile = await rebuildContentDna(workspaceId);
    return NextResponse.json({ dna_profile: profile }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/writer/dna/rebuild POST', error);
  }
}
