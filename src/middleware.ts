import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, GUEST_COOKIE, verifyToken } from "@/lib/auth";

/** Everything a guest needs the password to reach. */
const GUEST_PATHS = ["/invitation", "/rsvp", "/registry"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;

  if (pathname.startsWith("/admin")) {
    // /admin itself is the host sign-in screen; the rest of /admin is gated.
    if (pathname === "/admin") return NextResponse.next();

    if (!(await verifyToken(adminToken, "admin"))) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
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
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/invitation/:path*", "/rsvp/:path*", "/registry/:path*", "/admin/:path*"],
};
