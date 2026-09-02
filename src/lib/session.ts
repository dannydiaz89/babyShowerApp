import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, GUEST_COOKIE, verifyToken } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

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
  return (await verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin")) !== null;
}

/**
 * Whether the visitor has passed the *current* guest password — or is a host,
 * who is strictly the higher privilege and can already reach everything a guest
 * can.
 *
 * Two things are checked, and they fail differently:
 *
 * The signature proves the cookie was minted by this server and has not
 * expired. Middleware applies that same rule to the guest pages, but a Server
 * Action is its own public endpoint: it is reachable by POST without ever
 * loading the page it belongs to, and middleware does not run for it. Anything
 * a Server Action does on a guest's behalf has to check here as well.
 *
 * `guestSessionEpoch` is the second half, and the reason this reads settings at
 * all. A guest cookie is signed rather than stored, so there is nothing on the
 * server to delete when the hosts change the password — the old cookie stays
 * validly signed for its full 30 days. Refusing anything minted before the last
 * password change is what turns that rotation into an actual revocation.
 *
 * Fails closed when settings cannot be read. An outage means we cannot tell
 * whether a cookie predates a rotation, and guessing "it doesn't" would hand a
 * revoked guest their access back for exactly as long as Convex is down.
 */
export async function hasGuestAccess(): Promise<boolean> {
  const jar = await cookies();
  const [guest, admin] = await Promise.all([
    verifyToken(jar.get(GUEST_COOKIE)?.value, "guest"),
    verifyToken(jar.get(ADMIN_COOKIE)?.value, "admin"),
  ]);

  if (admin) return true;
  if (!guest) return false;

  const settings = await getSettings();
  if (!settings.available) return false;

  return guest.issuedAt >= (settings.guestSessionEpoch ?? 0);
}

/**
 * Guard a guest page, sending anyone without current access back to the gate.
 *
 * Middleware already turns away a visitor with no valid cookie, so what this
 * adds is the revocation check — which needs the database, and so cannot live
 * in middleware without putting a Convex read on every request to the site.
 * Here it is free: these pages read settings anyway, and `getSettings` is
 * memoised per request.
 *
 * Every page under GUEST_PATHS in src/middleware.ts needs this call. A new one
 * that forgets it is still gated by the password, but stays reachable with a
 * cookie the hosts have revoked.
 */
export async function requireGuestAccess(path: string): Promise<void> {
  if (await hasGuestAccess()) return;
  redirect(`/?next=${encodeURIComponent(path)}`);
}
