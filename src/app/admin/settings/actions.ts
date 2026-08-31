"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { api } from "../../../../convex/_generated/api";
import { ADMIN_COOKIE, verifyToken } from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";
import { hashPassword } from "@/lib/password";
import { getSettings } from "@/lib/settings";
import { getTranslation } from "@/lib/i18n";
import {
  SETTINGS_TABS,
  type SettingsState,
  type SettingsTab,
} from "@/lib/settings-tabs";
import { REGISTRY_ACCENTS, type Localized, type Settings } from "@/lib/defaults";


/** Server Actions aren't covered by middleware, so re-check the admin cookie. */
async function assertAdmin() {
  const ok = await verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  if (!ok) throw new Error("Not authorized.");
}

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function bool(form: FormData, key: string): boolean {
  return form.get(key) === "on";
}

function localized(form: FormData, key: string): Localized {
  return { en: str(form, `${key}.en`), es: str(form, `${key}.es`) };
}

/**
 * Rows post as `registries.0.name`, `registries.1.name`, and so on. Indexes go
 * sparse when a row is removed in the browser, so collect what's present
 * rather than counting from zero.
 */
function indexesFor(form: FormData, prefix: string): number[] {
  const found = new Set<number>();
  for (const key of form.keys()) {
    const match = key.match(new RegExp(`^${prefix}\\.(\\d+)\\.`));
    if (match) found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function readRegistries(form: FormData): Settings["registries"] {
  return indexesFor(form, "registries")
    .map((i) => ({
      name: str(form, `registries.${i}.name`),
      url: str(form, `registries.${i}.url`),
      description: localized(form, `registries.${i}.description`),
      accent: str(form, `registries.${i}.accent`),
    }))
    // A blank row is how someone clears an entry; drop it rather than saving it.
    .filter((r) => r.name && r.url)
    .map((r) => ({
      ...r,
      accent: (REGISTRY_ACCENTS as readonly string[]).includes(r.accent) ? r.accent : "sage",
    }));
}

function readMealOptions(form: FormData): Localized[] {
  return indexesFor(form, "mealOptions")
    .map((i) => localized(form, `mealOptions.${i}`))
    .filter((option) => option.en);
}

/** Only the fields the given tab owns. Everything else keeps its stored value. */
function fieldsForTab(tab: SettingsTab, form: FormData): Partial<Settings> {
  switch (tab) {
    case "event":
      return {
        babyName: str(form, "babyName"),
        honorees: str(form, "honorees"),
        venueName: str(form, "venueName"),
        address: str(form, "address"),
        mapsQuery: str(form, "mapsQuery") || str(form, "address"),
        startISO: str(form, "startISO"),
        endISO: str(form, "endISO"),
        rsvpDeadlineISO: str(form, "rsvpDeadlineISO"),
        contactName: str(form, "contactName"),
        contactEmail: str(form, "contactEmail"),
        giftShippingAddress: str(form, "giftShippingAddress"),
      };
    case "wording":
      return {
        tagline: localized(form, "tagline"),
        dressCode: localized(form, "dressCode"),
        notes: localized(form, "notes"),
      };
    case "registries":
      return { registries: readRegistries(form) };
    case "form":
      return {
        mealOptions: readMealOptions(form),
        askMeal: bool(form, "askMeal"),
        allowKids: bool(form, "allowKids"),
        collectPhone: bool(form, "collectPhone"),
      };
    case "access":
      // Handled separately — the password never goes through this path.
      return {};
  }
}

export async function saveSettings(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  await assertAdmin();
  const { t } = await getTranslation();

  const tab = String(formData.get("tab") ?? "") as SettingsTab;
  if (!SETTINGS_TABS.includes(tab)) {
    return { status: "error", message: t.settings.saveFailed };
  }

  try {
    const client = convexClient();
    const key = convexKey();

    // Read-modify-write: the mutation replaces the whole row, so merge this
    // tab's fields onto everything currently stored. Without this, saving one
    // tab would blank out the others.
    const current = await getSettings();
    const { guestPasswordHash, isConfigured, ...stored } = current;
    void guestPasswordHash;
    void isConfigured;

    if (tab !== "access") {
      await client.mutation(api.settings.update, {
        key,
        ...stored,
        ...fieldsForTab(tab, formData),
      });
    }

    let passwordMessage: string | undefined;
    let passwordOk: boolean | undefined;

    if (tab === "access") {
      const newPassword = str(formData, "guestPassword");
      if (!newPassword) {
        return { status: "saved", tab, message: t.settings.saved };
      }
      if (newPassword.length < 8) {
        return {
          status: "error",
          tab,
          passwordMessage: t.settings.guestPasswordTooShort,
          passwordOk: false,
        };
      }
      // Creating the row first means a first-run save can set a password too.
      if (!isConfigured) {
        await client.mutation(api.settings.update, { key, ...stored });
      }
      await client.mutation(api.settings.setGuestPasswordHash, {
        key,
        hash: await hashPassword(newPassword),
      });
      passwordMessage = t.settings.guestPasswordSaved;
      passwordOk = true;
    }

    revalidatePath("/", "layout");
    return { status: "saved", tab, message: t.settings.saved, passwordMessage, passwordOk };
  } catch (error) {
    console.error("Saving settings failed", error);
    return { status: "error", tab, message: t.settings.saveFailed };
  }
}
