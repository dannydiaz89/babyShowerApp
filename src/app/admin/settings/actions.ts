"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { api } from "../../../../convex/_generated/api";
import { ADMIN_COOKIE, verifyToken } from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";
import { hashPassword } from "@/lib/password";
import { fill, getTranslation } from "@/lib/i18n";
import { checkMealOptions } from "@/lib/meals";
import {
  SETTINGS_TABS,
  type SettingsState,
  type SettingsTab,
} from "@/lib/settings-tabs";
import {
  DEFAULT_SETTINGS,
  PHOTO_WALL_MODES,
  REGISTRY_ACCENTS,
  type Localized,
  type PhotoWallMode,
  type Settings,
} from "@/lib/defaults";


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
    case "photos": {
      const mode = str(form, "photoWall");
      const closes = str(form, "photoWallClosesISO");
      return {
        photoWall: (PHOTO_WALL_MODES as readonly string[]).includes(mode)
          ? (mode as PhotoWallMode)
          : "auto",
        // Blank keeps the wall open. Anything not a whole local datetime is
        // dropped rather than stored and silently never matching.
        photoWallClosesISO: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(closes) ? closes : "",
      };
    }
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

  /*
   * The catering breakdown is a capped array in one shared document — capped
   * so it cannot grow until it blocks every RSVP write. Saving a menu the
   * tally cannot hold would be worse than refusing it: the option would save,
   * guests would pick it, and it would simply be absent from the numbers the
   * hosts order food against, with nothing on screen to say so.
   */
  if (tab === "form") {
    const problem = checkMealOptions(readMealOptions(formData));
    if (problem) {
      return {
        status: "error",
        tab,
        message:
          problem.kind === "too-many"
            ? fill(t.settings.tooManyMealOptions, {
                count: problem.labels,
                max: problem.max,
              })
            : fill(t.settings.mealOptionTooLong, { max: problem.max }),
      };
    }
  }

  try {
    const client = convexClient();
    const key = convexKey();

    /*
     * Only this tab's own fields are sent, and Convex merges them into the
     * stored row inside one transaction. Reading the whole row here and
     * writing it all back would mean two hosts — or two browser tabs — saving
     * different sections from the same page load, with the later save
     * restoring the snapshot the earlier one had already replaced.
     *
     * DEFAULT_SETTINGS is only used when no row exists yet: a first save has
     * to produce a complete document, and the defaults live on this side.
     */
    if (tab !== "access") {
      await client.mutation(api.settings.update, {
        key,
        fields: fieldsForTab(tab, formData),
        defaults: DEFAULT_SETTINGS,
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
      // setGuestPasswordHash needs a row to patch, and an empty field set
      // creates one from the defaults if this is the hosts' very first save.
      await client.mutation(api.settings.update, {
        key,
        fields: {},
        defaults: DEFAULT_SETTINGS,
      });
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
