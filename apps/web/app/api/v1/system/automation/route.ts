import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { isAutomationEnabled, setAutomationEnabled } from '@/lib/system/kill-switch';

// Global, not workspace-scoped: this is the whole-account emergency stop for
// every paid background job (Claude calls, publishing, media generation).
// Any authenticated member can flip it — same trust level as the rest of
// Settings, and an account-wide switch has no meaningful per-workspace ACL.

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await authenticate(req);
    return NextResponse.json({ automation_enabled: await isAutomationEnabled() });
  } catch (error) {
    return handleRouteError('v1/system/automation GET', error);
  }
}

const patchSchema = z.object({ automation_enabled: z.boolean() });

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    await authenticate(req);
    const { automation_enabled } = patchSchema.parse(await req.json());
    await setAutomationEnabled(automation_enabled);
    return NextResponse.json({ automation_enabled });
  } catch (error) {
    return handleRouteError('v1/system/automation PATCH', error);
  }
}
