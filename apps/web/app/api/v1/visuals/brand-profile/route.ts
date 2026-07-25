import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getBrandProfile, upsertBrandProfile } from '@/lib/media/brand-profile';

// GET/PUT /api/v1/visuals/brand-profile (Plan 2 / 2A.5).
// Das Profil fließt in jedes Template und in jeden generierten Bild-Prompt.

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Erwartet wird ein Hex-Wert wie #1A2B3C.');

const patchSchema = z
  .object({
    color_primary: hex,
    color_secondary: hex,
    color_accent: hex,
    color_background: hex,
    color_foreground: hex,
    color_muted: hex,
    font_family: z.string().trim().min(1).max(60),
    font_scale: z.number().min(0.6).max(2),
    heading_weight: z.union([
      z.literal(400), z.literal(500), z.literal(600),
      z.literal(700), z.literal(800), z.literal(900),
    ]),
    corner_radius: z.number().int().min(0).max(96),
    imagery_style: z.string().trim().max(400).nullable(),
    imagery_avoid: z.array(z.string().trim().min(1).max(60)).max(12),
    logo_storage_key: z.string().trim().max(300).nullable(),
    logo_placement: z.enum(['none', 'top_left', 'top_right', 'bottom_left', 'bottom_right']),
    watermark_text: z.string().trim().max(60).nullable(),
  })
  .partial();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const profile = await getBrandProfile(workspaceId);
    return NextResponse.json({ brand_profile: profile });
  } catch (error) {
    return handleRouteError('v1/visuals/brand-profile GET', error);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const patch = patchSchema.parse(body);
    if (Object.keys(patch).length === 0) {
      return jsonError(400, 'Es wurde kein Feld übergeben.', 'invalid_request');
    }
    const profile = await upsertBrandProfile(workspaceId, patch);
    return NextResponse.json({ brand_profile: profile });
  } catch (error) {
    return handleRouteError('v1/visuals/brand-profile PUT', error);
  }
}
