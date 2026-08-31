import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, GUEST_COOKIE, verifyToken } from "@/lib/auth";

/**
 * Who the visitor is, read from their cookies.
 *
 * Kept out of lib/auth.ts because that module runs in middleware on the edge
 * runtime, where next/headers is not available.
 */

/**
 * Whether the visitor is a signed-in host. Guest pages use this to show a
 * preview bar instead of the normal sign-out control, so a host previewing the
 * site can get back to the dashboard without ending their session.
 */
export async function isAdminSession(): Promise<boolean> {
  return verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
}

/**
 * Whether the visitor has passed the guest password — or is a host, who is
 * strictly the higher privilege and can already reach everything a guest can.
 *
 * Middleware applies this same rule to the guest pages, but a Server Action is
 * its own public endpoint: it is reachable by POST without ever loading the
 * page it belongs to, and middleware does not run for it. Anything a Server
 * Action does on a guest's behalf has to check here as well.
 */
export async function hasGuestAccess(): Promise<boolean> {
  const jar = await cookies();
  const [guest, admin] = await Promise.all([
    verifyToken(jar.get(GUEST_COOKIE)?.value, "guest"),
    verifyToken(jar.get(ADMIN_COOKIE)?.value, "admin"),
  ]);
  return guest || admin;
}
