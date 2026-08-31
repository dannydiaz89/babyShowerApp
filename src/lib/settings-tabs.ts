/**
 * Shared between the settings form and its server action.
 *
 * This deliberately does NOT live in actions.ts: a "use server" module may
 * only export async functions, so a plain array exported from there is not a
 * real array at runtime — it silently becomes unusable in the client bundle.
 */
export const SETTINGS_TABS = ["event", "wording", "registries", "form", "access"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type SettingsState = {
  status: "idle" | "saved" | "error";
  /** Which tab the result belongs to, so a stale message can't show elsewhere. */
  tab?: SettingsTab;
  message?: string;
  passwordMessage?: string;
  passwordOk?: boolean;
};
