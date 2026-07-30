import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError } from '@/lib/api/http';
import { rebuildContentDna } from '@/lib/writer/samples';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (auth.method !== 'session' || auth.workspaceRole !== 'admin') {
      throw new ApiError(
        403,
        'Only workspace owners and admins can rebuild Content DNA.',
        'forbidden'
      );
    }
    const workspaceId = auth.workspaceId;
    const profile = await rebuildContentDna(workspaceId);
    return NextResponse.json({ dna_profile: profile }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/writer/dna/rebuild POST', error);
  }
}
