import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { importGoldenSampleBundle, loadCuratedGoldenSampleFiles } from '@/lib/writer/bundle-import';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    await requireWriterOwnerOrAdmin(auth);
    const files = await loadCuratedGoldenSampleFiles();
    const result = await importGoldenSampleBundle(auth.workspaceId, files, '2026-08-01');
    return NextResponse.json({ ...result, idempotent: true });
  } catch (error) {
    return handleRouteError('v1/writer/samples/import POST', error);
  }
}
