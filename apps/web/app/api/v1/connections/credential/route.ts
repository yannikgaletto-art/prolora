import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { connectCredentialPlatform } from '@/lib/connections/credential-connect';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    return NextResponse.json({ connection: await connectCredentialPlatform(workspaceId, body) }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/connections/credential POST', error);
  }
}
