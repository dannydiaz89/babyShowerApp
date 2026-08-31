import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Free text the hosts write, in both languages. Spanish may be left blank. */
const localized = v.object({ en: v.string(), es: v.string() });

export default defineSchema({
  rsvps: defineTable({
    name: v.string(),
    // Either one identifies a guest; not everyone has an email address.
    email: v.optional(v.string()),
    phone: v.optional(v.string()),

    attending: v.boolean(),

    // adults includes the person responding.
    adults: v.number(),
    kids: v.number(),

    guestNames: v.optional(v.string()),
    meal: v.optional(v.string()),
    dietaryNotes: v.optional(v.string()),
    message: v.optional(v.string()),

    /*
     * Normalised lookup keys, so re-submitting updates an answer instead of
     * duplicating it. emailKey is lowercased; phoneKey is digits only, so
     * "(512) 555-0134" and "512-555-0134" are the same person. Either may be
     * absent, and a guest is matched on whichever they gave.
     */
    emailKey: v.optional(v.string()),
    phoneKey: v.optional(v.string()),

    submittedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["emailKey"])
    .index("by_phone", ["phoneKey"])
    .index("by_submitted", ["submittedAt"]),

  /**
   * A single row holding everything the hosts can edit. Absent until the first
   * save, at which point it is created from the built-in defaults.
   */
  settings: defineTable({
    singleton: v.literal("settings"),

    // Identity
    babyName: v.string(),
    honorees: v.string(),

    // Place
    venueName: v.string(),
    address: v.string(),
    mapsQuery: v.string(),

    // Time. Stored as ISO so it can be formatted in either language, rather
    // than as a pre-written English string.
    startISO: v.string(),
    endISO: v.string(),
    rsvpDeadlineISO: v.string(),

    // Free text, per language
    tagline: localized,
    // Retired from the UI; kept optional so existing rows still validate.
    hosts: v.optional(localized),
    dressCode: localized,
    notes: localized,

    // Contact and gifts
    contactName: v.string(),
    contactEmail: v.string(),
    giftShippingAddress: v.string(),

    registries: v.array(
      v.object({
        name: v.string(),
        url: v.string(),
        description: localized,
        accent: v.string(),
      })
    ),

    // What the RSVP form asks
    mealOptions: v.array(localized),
    askMeal: v.boolean(),
    allowKids: v.boolean(),
    collectPhone: v.boolean(),

    // Guest password, rotatable without redeploying. "salt:derivedKey", both hex.
    // Absent means fall back to the SITE_PASSWORD environment variable.
    guestPasswordHash: v.optional(v.string()),

    updatedAt: v.number(),
  }).index("by_singleton", ["singleton"]),

  /**
   * Failed sign-in counter, so shared passwords can't be brute-forced.
   * Keyed on role + client IP.
   */
  loginAttempts: defineTable({
    key: v.string(),
    failures: v.number(),
    windowStart: v.number(),
    lockedUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),
});
