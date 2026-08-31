"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "../../convex/_generated/api";
import {
  ADMIN_COOKIE,
  GUEST_COOKIE,
  cookieOptions,
  createToken,
  passwordMatches,
  type Role,
} from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";
import { safeNext } from "@/lib/nav";
import { verifyPassword } from "@/lib/password";
import { getSettings } from "@/lib/settings";
import { LOCALE_COOKIE, getTranslation, fill, isLocale } from "@/lib/i18n";

export type LoginState = { error?: string };

/**
 * Who is knocking. Behind Vercel this is the real client address; locally it
 * falls back to a shared bucket, which errs toward limiting too much rather
 * than too little.
 */
async function clientId(role: Role): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || "unknown";
  return `${role}:${ip}`;
}

type LimitCheck = { blocked: boolean; retryAfterMs: number; unavailable?: boolean };

async function checkLimit(role: Role, id: string): Promise<LimitCheck> {
  try {
    // A mutation, not a query: a lockout expires with the passage of time, and
    // a query result does not. See the comment on rateLimit.check.
    return await convexClient().mutation(api.rateLimit.check, {
      key: convexKey(),
      id,
    });
  } catch (error) {
    console.error("Rate limit check failed", error);
    // Admin fails closed: without a working limiter, that password is the only
    // thing protecting the guest list. Guests fail open so a backend blip
    // doesn't lock everyone out of the invitation.
    if (role === "admin") {
      return { blocked: true, retryAfterMs: 60_000, unavailable: true };
    }
    return { blocked: false, retryAfterMs: 0 };
  }
}

async function recordFailure(role: Role, id: string): Promise<LimitCheck> {
  try {
    return await convexClient().mutation(api.rateLimit.fail, {
      key: convexKey(),
      id,
      role,
    });
  } catch (error) {
    console.error("Rate limit record failed", error);
    return { blocked: false, retryAfterMs: 0 };
  }
}

async function clearFailures(id: string): Promise<void> {
  try {
    await convexClient().mutation(api.rateLimit.succeed, { key: convexKey(), id });
  } catch (error) {
    console.error("Rate limit reset failed", error);
  }
}

function lockoutMessage(template: string, retryAfterMs: number): string {
  return fill(template, { minutes: Math.max(1, Math.ceil(retryAfterMs / 60_000)) });
}

/**
 * Check the guest password: the one set in the admin page, or the environment
 * fallback when the hosts have never set one.
 *
 * Fails closed when the settings cannot be read. Falling back to
 * SITE_PASSWORD in that case would mean a Convex outage silently reinstates a
 * password the hosts have already rotated away from — and the 30-day session
 * it issues keeps working long after the outage ends.
 */
type PasswordCheck = "ok" | "wrong" | "unavailable";

async function checkGuestPassword(submitted: string): Promise<PasswordCheck> {
  const settings = await getSettings();
  if (!settings.available) return "unavailable";

  const matches = settings.guestPasswordHash
    ? await verifyPassword(submitted.trim(), settings.guestPasswordHash)
    : await passwordMatches(submitted, process.env.SITE_PASSWORD);

  return matches ? "ok" : "wrong";
}

export async function guestLogin(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const { t } = await getTranslation();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const id = await clientId("guest");

  const limit = await checkLimit("guest", id);
  if (limit.blocked) {
    return { error: lockoutMessage(t.gate.lockedOut, limit.retryAfterMs) };
  }

  const check = await checkGuestPassword(password);

  // Not the guest's mistake, so it costs them nothing against the limiter.
  if (check === "unavailable") return { error: t.gate.unavailable };

  if (check === "wrong") {
    const result = await recordFailure("guest", id);
    return {
      error: result.blocked
        ? lockoutMessage(t.gate.lockedOut, result.retryAfterMs)
        : t.gate.wrong,
    };
  }

  await clearFailures(id);
  (await cookies()).set(GUEST_COOKIE, await createToken("guest"), cookieOptions("guest"));
  redirect(next);
}

export async function adminLogin(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const { t } = await getTranslation();
  const password = String(formData.get("password") ?? "");
  const id = await clientId("admin");

  const limit = await checkLimit("admin", id);
  if (limit.blocked) {
    return {
      error: limit.unavailable
        ? t.gate.limiterUnavailable
        : lockoutMessage(t.gate.lockedOut, limit.retryAfterMs),
    };
  }

  if (!(await passwordMatches(password, process.env.ADMIN_PASSWORD))) {
    const result = await recordFailure("admin", id);
    return {
      error: result.blocked
        ? lockoutMessage(t.gate.lockedOut, result.retryAfterMs)
        : t.admin.wrongPassword,
    };
  }

  await clearFailures(id);
  (await cookies()).set(ADMIN_COOKIE, await createToken("admin"), cookieOptions("admin"));
  redirect("/admin/dashboard");
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
  jar.delete(ADMIN_COOKIE);
  redirect("/");
}

/** Switch languages and stay on the current page. */
export async function setLocale(formData: FormData) {
  const locale = String(formData.get("locale") ?? "");
  const back = safeNext(formData.get("next"));

  if (isLocale(locale)) {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  redirect(back);
}
