"use server";

import { headers } from "next/headers";
import { api } from "../../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import { getTranslation } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

export type RsvpState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** True when we replaced an earlier answer from the same email address. */
  updated?: boolean;
  /** Field name -> problem, so the form can highlight what to fix. */
  errors?: Record<string, string>;
  attending?: boolean;
  /**
   * What the guest typed. React 19 resets an uncontrolled form once its action
   * returns, so without echoing these back a rejected submission would wipe
   * everything they filled in.
   */
  values?: Record<string, string>;
};

/** Anyone with the guest password could otherwise flood the headcount. */
const SUBMISSIONS_PER_HOUR = 12;

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function count(formData: FormData, key: string, fallback: number): number {
  const n = Number(formData.get(key));
  return Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : fallback;
}

export async function submitRsvp(
  _prev: RsvpState,
  formData: FormData
): Promise<RsvpState> {
  const [{ t }, settings] = await Promise.all([getTranslation(), getSettings()]);

  const name = text(formData, "name");
  const email = text(formData, "email");
  const attending = formData.get("attending") === "yes";

  const phone = settings.collectPhone ? text(formData, "phone") : "";
  // Digits only: a US number is 10, but allow a short local one.
  const phoneDigits = phone.replace(/\D/g, "");

  const adults = count(formData, "adults", 1);

  const errors: Record<string, string> = {};
  if (!name) errors.name = t.rsvp.errNameRequired;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = t.rsvp.errEmailInvalid;
  }
  if (phone && phoneDigits.length < 7) {
    errors.phone = t.rsvp.errPhoneInvalid;
  }

  /*
   * One contact detail is enough. Not every guest has an email address, and
   * either one is a stable key for updating an answer later. When the hosts
   * have turned the phone field off, email is the only option left.
   */
  if (!email && !phone) {
    if (settings.collectPhone) {
      errors.email = t.rsvp.errContactRequired;
    } else {
      errors.email = t.rsvp.errEmailRequired;
    }
  }

  if (attending && adults < 1) errors.adults = t.rsvp.errAdults;

  // Every field, so nothing the guest typed is lost when we reject a submission.
  const values: Record<string, string> = {
    name,
    email,
    phone,
    adults: String(adults),
    kids: String(count(formData, "kids", 0)),
    guestNames: text(formData, "guestNames"),
    meal: text(formData, "meal"),
    dietaryNotes: text(formData, "dietaryNotes"),
    message: text(formData, "message"),
  };

  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, attending, values };
  }

  try {
    const client = convexClient();
    const key = convexKey();

    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

    const throttle = await client.mutation(api.rateLimit.consume, {
      key,
      id: `rsvp:${ip}`,
      limit: SUBMISSIONS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });

    if (!throttle.allowed) {
      return { status: "error", message: t.rsvp.errSaving, attending, values };
    }

    const result = await client.mutation(api.rsvps.submit, {
      key,
      name,
      email: email || undefined,
      // Only store what the hosts actually asked for.
      phone: phone || undefined,
      attending,
      adults,
      kids: settings.allowKids ? count(formData, "kids", 0) : 0,
      guestNames: text(formData, "guestNames") || undefined,
      meal: settings.askMeal ? text(formData, "meal") || undefined : undefined,
      dietaryNotes: text(formData, "dietaryNotes") || undefined,
      message: text(formData, "message") || undefined,
    });

    return { status: "success", updated: result.updated, attending };
  } catch (error) {
    console.error("RSVP submission failed", error);
    return { status: "error", message: t.rsvp.errSaving, attending, values };
  }
}
