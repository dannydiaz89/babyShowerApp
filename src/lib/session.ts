import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyToken } from "@/lib/auth";

/**
 * Whether the visitor is a signed-in host. Guest pages use this to show a
 * preview bar instead of the normal sign-out control, so a host previewing the
 * site can get back to the dashboard without ending their session.
 *
 * Kept out of lib/auth.ts because that module runs in middleware on the edge
 * runtime, where next/headers is not available.
 */
export async function isAdminSession(): Promise<boolean> {
  return verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
}
