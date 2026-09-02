import { NextResponse } from "next/server";
import { probeDrive } from "@/lib/google-drive";
import { isAdminSession } from "@/lib/session";

/*
 * POST /api/google/check — hosts only.
 *
 * "Check again" on the Photos settings tab: ask Google whether the
 * connection works and record the answer, which is what lifts a pause.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (!(await isAdminSession())) return NextResponse.redirect(new URL("/admin", origin), 303);

  const ok = await probeDrive();
  return NextResponse.redirect(
    new URL(`/admin/settings?tab=photos&drive=${ok ? "healthy" : "stillfailing"}`, origin),
    303
  );
}
