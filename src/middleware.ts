import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, GUEST_COOKIE, verifyToken } from "@/lib/auth";
import { contentSecurityPolicy, cspNonce } from "@/lib/csp";
import {
  UPLOADER_COOKIE,
  mintUploaderCookie,
  readUploaderCookie,
  uploaderCookieOptions,
} from "@/lib/photo-device";

/** Everything a guest needs the password to reach. */
const GUEST_PATHS = ["/invitation", "/rsvp", "/registry", "/photos"];

/**
 * Photo web copies are served from Convex storage, which lives at the
 * deployment URL; originals go from the phone straight to Google Drive.
 * Both origins are named here so the policy can stay strict everywhere else.
 */
const DRIVE_UPLOAD_ORIGIN = "https://www.googleapis.com";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = cspNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development", {
    imageOrigins: process.env.CONVEX_URL ? [process.env.CONVEX_URL] : [],
    connectOrigins: [DRIVE_UPLOAD_ORIGIN],
  });

  /*
   * The policy travels inbound as well as back out. Next.js reads the nonce off
   * the *request* header (app-render looks for 'nonce-…' in script-src) and
   * stamps it on the scripts it inlines; without this the browser would be sent
   * a nonce that matches nothing and the page would load no JavaScript at all.
   * x-nonce is there for any component that later needs to inline its own.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);

  /** Every exit below goes through here, so no response can ship without the policy. */
  const send = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  const proceed = async () => {
    const response = send(NextResponse.next({ request: { headers: requestHeaders } }));
    /*
     * The photo pages get their device cookie here, on the page load, not on
     * the first upload. An upload batch opens three sessions at once, and if
     * none of them had a cookie yet each would mint its own — three ids for
     * one phone, and two thirds of its photos not "yours". The routes still
     * mint one if it is missing, as a fallback; this just makes sure it is not.
     * A cookie that does not carry a valid signature counts as missing.
     */
    if (
      pathname.startsWith("/photos") &&
      !(await readUploaderCookie(request.cookies.get(UPLOADER_COOKIE)?.value))
    ) {
      response.cookies.set(UPLOADER_COOKIE, await mintUploaderCookie(), uploaderCookieOptions());
    }
    return response;
  };

  const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;

  if (pathname.startsWith("/admin")) {
    // /admin itself is the host sign-in screen; the rest of /admin is gated.
    if (pathname === "/admin") return proceed();

    if (!(await verifyToken(adminToken, "admin"))) {
      return send(NextResponse.redirect(new URL("/admin", request.url)));
    }
    return proceed();
  }

  if (GUEST_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // A signed-in host can view the guest pages without the guest password —
    // that's what "View site" is for. Admin is strictly the higher privilege,
    // so letting it through opens nothing a host couldn't already reach.
    const allowed =
      (await verifyToken(request.cookies.get(GUEST_COOKIE)?.value, "guest")) ||
      (await verifyToken(adminToken, "admin"));

    if (!allowed) {
      const url = new URL("/", request.url);
      // Send them where they were headed once they enter the password.
      url.searchParams.set("next", pathname);
      return send(NextResponse.redirect(url));
    }
  }

  return proceed();
}

export const config = {
  /*
   * Everything except the build's own static output.
   *
   * The auth rules above still only act on /admin and the three guest paths,
   * but the CSP has to reach every document — including the gate at "/", which
   * the previous matcher did not cover and which is the one page a logged-out
   * visitor ever sees.
   *
   * Prefetches are deliberately NOT excluded here. next/link prefetches
   * /invitation and friends from the header nav, and those responses carry the
   * page's rendered content; skipping the middleware for them would hand the
   * guest pages to anyone who never entered the password.
   *
   * _next/static and _next/image are immutable asset responses. A policy on
   * them governs nothing — it is the document's CSP that decides what a page is
   * allowed to load.
   */
  matcher: ["/((?!_next/static|_next/image).*)"],
};
