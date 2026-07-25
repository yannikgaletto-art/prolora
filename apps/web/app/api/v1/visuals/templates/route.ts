import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getBrandProfile } from '@/lib/media/brand-profile';
import { VISUAL_FORMATS, VISUAL_TEMPLATE_CATALOG } from '@/lib/media/visual-templates';

// GET /api/v1/visuals/templates (Plan 2 / 2A.6) — Katalog + wirksames Brand-Profil.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const profile = await getBrandProfile(workspaceId);
    return NextResponse.json({
      templates: VISUAL_TEMPLATE_CATALOG,
      formats: VISUAL_FORMATS,
      brand_profile: profile,
    });
  } catch (error) {
    return handleRouteError('v1/visuals/templates GET', error);
  }
}
