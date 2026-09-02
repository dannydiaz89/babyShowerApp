import "server-only";
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
 * Per device, per hour. Generous for a guest — ten photos is three requests
 * each — and small against someone with the guest password scripting
 * uploads to fill the wall or the storage.
 */
export const PHOTO_RATE = {
  sessions: 150,
  creates: 150,
  hides: 60,
} as const;

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

/** A photo id as it arrives in a URL: something Convex could accept, or nothing. */
export function photoIdParam(value: string | undefined): string | null {
  if (!value || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
