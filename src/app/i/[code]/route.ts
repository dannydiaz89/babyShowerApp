import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { GUEST_COOKIE, cookieOptions, createToken } from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";
import { inviteCodeMatches } from "@/lib/invite";
import { safeNext } from "@/lib/nav";
import { hasCurrentGuestCookie } from "@/lib/session";
import { getSettings } from "@/lib/settings";

/*
 * GET /i/<code>
 *
 * The QR on the printed invitation. A valid code mints exactly the cookie the
 * password form mints — same token, same month, same revocation — so this adds
 * a way to present the credential and nothing to the session model.
 *
 * A route handler rather than a page because only a route handler and a Server
 * Action may set a cookie, and because there is nothing to render: every path
 * out of here is a redirect, which also means the URL carrying the code is
 * never a page anyone lingers on, screenshots, or leaks through a Referer.
 *
 * `?next=` picks the destination — /invitation for the invitation card,
 * /photos for a table card at the party. It goes through `safeNext`, so a
 * fabricated link cannot use this as an open redirect.
 */

export const dynamic = "force-dynamic";

/** Behind Vercel this is the real client; locally everyone shares a bucket. */
async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Wrong codes count against their own per-address lockout, not the password's.
 *
 * Separate because the password is the fallback printed beside the QR: a guest
 * whose card is out of date must not scan themselves out of the form they are
 * about to be told to use. Ten guesses per quarter hour against fifty bits is
 * not a search anyone finishes.
 */
function limiterId(address: string): string {
  return `invite:${address}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  /*
   * `safeNext` keeps the destination on this site; this keeps it off this
   * route. A hand-made /i/<code>?next=/i/<code> would otherwise mint a cookie,
   * land back here, and mint another until the browser gave up — harmless, but
   * there is no reason for a scan to send anyone to a second scan.
   */
  const asked = safeNext(new URL(request.url).searchParams.get("next"));
  const next = asked === "/i" || asked.startsWith("/i/") ? "/invitation" : asked;

  const client = convexClient();
  const key = convexKey();
  const address = await clientAddress();

  /*
   * Nothing here is cacheable: it sets a session cookie, and its answer
   * depends on a code the hosts can revoke between two scans.
   */
  const send = (response: NextResponse) => {
    response.headers.set("Cache-Control", "no-store");
    // A code should never end up in an index, however one is found.
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  };

  /** The password form, with a word about why the link did not work. */
  const toGate = (stale: boolean) => {
    const url = new URL("/", request.url);
    if (next !== "/invitation") url.searchParams.set("next", next);
    if (stale) url.searchParams.set("link", "stale");
    return send(NextResponse.redirect(url));
  };

  let blocked = false;
  try {
    const limit = await client.mutation(api.rateLimit.check, {
      key,
      id: limiterId(address),
    });
    blocked = limit.blocked;
  } catch (error) {
    // A blip in the limiter should not turn a scanned invitation away; the
    // code still has to be right, and that check is below.
    console.error("Invite link limit check failed", error);
  }

  const settings = await getSettings();

  /*
   * Fails closed. Without settings we cannot tell a good code from a revoked
   * one, and minting a month-long cookie on a guess is not the way to find
   * out. The gate still takes the password, which fails closed the same way.
   */
  if (!settings.available) return toGate(false);

  if (!blocked && inviteCodeMatches(code, settings.inviteCode)) {
    try {
      await client.mutation(api.rateLimit.succeed, { key, id: limiterId(address) });
    } catch (error) {
      console.error("Invite link limit reset failed", error);
    }

    const response = send(NextResponse.redirect(new URL(next, request.url)));
    response.cookies.set(GUEST_COOKIE, await createToken("guest"), cookieOptions("guest"));
    return response;
  }

  /*
   * A guest who is already signed in scanned an old card. They are entitled to
   * where they were going and the dead code granted them nothing, so send them
   * on rather than bouncing them to a password they have already given — and
   * do not count it against the limiter, which would punish them for the
   * hosts' rotation. Nobody reaches this line without current access, so it is
   * no help to someone guessing codes.
   */
  if (await hasCurrentGuestCookie()) {
    return send(NextResponse.redirect(new URL(next, request.url)));
  }

  if (!blocked) {
    try {
      await client.mutation(api.rateLimit.fail, {
        key,
        id: limiterId(address),
        role: "guest",
      });
    } catch (error) {
      console.error("Invite link failure record failed", error);
    }
  }

  /*
   * One message for a wrong code and for a lockout. The guest's next move is
   * the same either way — type the password — and someone working through the
   * code space learns nothing about when they were cut off.
   */
  return toGate(true);
}
