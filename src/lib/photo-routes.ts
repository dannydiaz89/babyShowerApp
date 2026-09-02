import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { api } from "../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import type { PhotoErrorCode } from "@/lib/photo-codes";

/**
 * What the photo Route Handlers share.
 *
 * Route Handlers, like Server Actions, sit outside the middleware's page
 * gate: each one is its own public endpoint and checks the session itself.
 * These helpers keep the refusals and the throttling identical across them.
 */

const HOUR = 60 * 60 * 1000;

/**
 * Per hour. The device limits are what a guest feels — ten photos is a
 * handful of requests each. The per-address limits are the backstop: a
 * device id is signed, but a fresh one costs only a page load, so a
 * scripted caller is bounded by where it comes from as well. A venue's
 * shared Wi-Fi puts sixty guests behind one address, which is what the
 * address figures are sized for.
 */
export const PHOTO_RATE = {
  sessions: 60,
  creates: 60,
  hides: 60,
  sessionsPerAddress: 900,
  createsPerAddress: 900,
} as const;

/** Who is calling, as an address. Behind Vercel this is the real client. */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** A refusal the client can put words to. */
export function refuse(code: PhotoErrorCode, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

/**
 * True if this device may go ahead.
 *
 * Fails open when the limiter itself cannot be reached: the next call — the
 * upload — needs Convex too and will fail on its own, and a photo is not a
 * password. The admin sign-in is where failing closed matters.
 */
export async function withinLimit(id: string, limit: number): Promise<boolean> {
  try {
    const result = await convexClient().mutation(api.rateLimit.consume, {
      key: convexKey(),
      id,
      limit,
      windowMs: HOUR,
    });
    return result.allowed;
  } catch (error) {
    console.error("Photo rate limit check failed", error);
    return true;
  }
}

/** Both limits for one kind of request: the device's and its address's. */
export async function withinLimits(
  kind: "session" | "create",
  uploaderId: string
): Promise<boolean> {
  const address = await clientAddress();
  const [device, byAddress] = await Promise.all([
    withinLimit(`photos:${kind}:${uploaderId}`, kind === "session" ? PHOTO_RATE.sessions : PHOTO_RATE.creates),
    withinLimit(
      `photos:${kind}:ip:${address}`,
      kind === "session" ? PHOTO_RATE.sessionsPerAddress : PHOTO_RATE.createsPerAddress
    ),
  ]);
  return device && byAddress;
}

/** A photo id as it arrives in a URL: something Convex could accept, or nothing. */
export function photoIdParam(value: string | undefined): string | null {
  if (!value || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
