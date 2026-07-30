import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getContentDna } from '@/lib/writer/samples';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const result = await getContentDna(workspaceId);
    return NextResponse.json({
      dna_profile: result.dnaProfile,
      fallback: result.fallback,
    });
  } catch (error) {
    return handleRouteError('v1/writer/dna GET', error);
  }
}
