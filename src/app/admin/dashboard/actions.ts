"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ADMIN_COOKIE, verifyToken } from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";

/** Server Actions aren't covered by middleware, so re-check the admin cookie. */
async function assertAdmin() {
  const ok = await verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  if (!ok) throw new Error("Not authorized.");
}

/**
 * Fold duplicate RSVPs into one. The headcount comes from the form rather than
 * being summed: two rows can mean one household counted twice, or two people
 * who each answered for themselves, and only the hosts know which.
 */
export async function mergeRsvps(formData: FormData) {
  await assertAdmin();

  const keepId = String(formData.get("keepId") ?? "");
  const removeIds = formData
    .getAll("removeIds")
    .map(String)
    .filter((id) => id && id !== keepId);
  if (!keepId || removeIds.length === 0) return;

  const str = (field: string) => String(formData.get(field) ?? "").trim();
  const count = (field: string) => {
    const n = Number(formData.get(field));
    return Number.isFinite(n) ? Math.max(0, Math.min(40, Math.round(n))) : 0;
  };

  await convexClient().mutation(api.rsvps.merge, {
    key: convexKey(),
    keepId: keepId as Id<"rsvps">,
    removeIds: removeIds as Id<"rsvps">[],
    name: str("name"),
    email: str("email") || undefined,
    phone: str("phone") || undefined,
    attending: formData.get("attending") === "yes",
    adults: count("adults"),
    kids: count("kids"),
    guestNames: str("guestNames") || undefined,
    meal: str("meal") || undefined,
    dietaryNotes: str("dietaryNotes") || undefined,
    message: str("message") || undefined,
  });

  revalidatePath("/admin/dashboard");
}

/** Host edit of one RSVP, from the dashboard's detail dialog. */
export async function updateRsvp(formData: FormData) {
  await assertAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const str = (field: string) => String(formData.get(field) ?? "").trim();
  const count = (field: string) => {
    const n = Number(formData.get(field));
    return Number.isFinite(n) ? Math.max(0, Math.min(40, Math.round(n))) : 0;
  };

  await convexClient().mutation(api.rsvps.update, {
    key: convexKey(),
    id: id as Id<"rsvps">,
    name: str("name"),
    email: str("email") || undefined,
    phone: str("phone") || undefined,
    attending: formData.get("attending") === "yes",
    adults: count("adults"),
    kids: count("kids"),
    guestNames: str("guestNames") || undefined,
    meal: str("meal") || undefined,
    dietaryNotes: str("dietaryNotes") || undefined,
    message: str("message") || undefined,
  });

  revalidatePath("/admin/dashboard");
}

/**
 * Delete one or more RSVPs. Always plural: the dashboard deletes a single row
 * and a whole selection through the same confirmed path, so there is only one
 * place where guest data is destroyed.
 */
export async function deleteRsvps(formData: FormData) {
  await assertAdmin();

  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;

  await convexClient().mutation(api.rsvps.removeMany, {
    key: convexKey(),
    ids: ids as Id<"rsvps">[],
  });

  revalidatePath("/admin/dashboard");
}
