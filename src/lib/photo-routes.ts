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
 * Per hour. Three kinds of limit, for three different callers.
 *
 * Per device is what one guest feels: ten photos is ten of each request,
 * so a hundred and twenty an hour is a very busy guest.
 *
 * Per address is a backstop only, and deliberately far above anything a
 * room produces: the whole party is usually behind the venue's one Wi-Fi
 * address, and a limit that a big party could reach by uploading normally
 * would be the wrong trade. Three thousand an hour is three hundred guests
 * each uploading ten photos in the same hour.
 *
 * Outstanding sessions per address is the limit that actually answers a
 * script. A Drive session that is opened and never finished is the abuse
 * — originals landing in the hosts' Drive with no photo on the wall —
 * and honest traffic finishes what it opens, so the count stays near zero
 * however many guests share the address. Two hundred left open at once is
 * far past a Wi-Fi hiccup and far short of filling a Drive.
 */
export const PHOTO_RATE = {
  sessions: 120,
  creates: 120,
  hides: 60,
  perAddress: 3000,
  outstandingPerAddress: 200,
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

/** Both limits for one kind of request: the device's and its address's backstop. */
export async function withinLimits(
  kind: "session" | "create",
  uploaderId: string
): Promise<boolean> {
  const address = await clientAddress();
  const [device, byAddress] = await Promise.all([
    withinLimit(`photos:${kind}:${uploaderId}`, kind === "session" ? PHOTO_RATE.sessions : PHOTO_RATE.creates),
    withinLimit(`photos:${kind}:ip:${address}`, PHOTO_RATE.perAddress),
  ]);
  return device && byAddress;
}

function outstandingId(address: string): string {
  return `photos:outstanding:ip:${address}`;
}

/** Count a Drive session as opened; false when too many from this address are still open. */
export async function openOutstanding(): Promise<boolean> {
  return withinLimit(outstandingId(await clientAddress()), PHOTO_RATE.outstandingPerAddress);
}

/** A session was finished — its original has a photo on the wall — so it no longer counts. */
export async function closeOutstanding(): Promise<void> {
  try {
    await convexClient().mutation(api.rateLimit.release, {
      key: convexKey(),
      id: outstandingId(await clientAddress()),
    });
  } catch (error) {
    console.error("Releasing an outstanding session failed", error);
  }
}

/** A photo id as it arrives in a URL: something Convex could accept, or nothing. */
export function photoIdParam(value: string | undefined): string | null {
  if (!value || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
