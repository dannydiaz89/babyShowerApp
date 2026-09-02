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

    /*
     * When guest sessions were last invalidated.
     *
     * Guest cookies are stateless — signed, with nothing on the server to
     * delete — so changing the password would otherwise leave every session
     * minted under the old one working for its full 30 days. Bumping this on
     * every password change gives the signature a floor to be checked against,
     * which is what makes rotating the password actually revoke access.
     *
     * Optional: rows written before this existed read as "never invalidated".
     */
    guestSessionEpoch: v.optional(v.number()),

    /*
     * When guests may add photos. "auto" opens the wall on the event date;
     * "open" opens it now, for a test run. Either way it stays open until
     * `photoWallClosesISO`, a local "YYYY-MM-DDTHH:mm" like `startISO`, or
     * for ever when that is blank. Set once and forgotten, rather than a
     * switch someone has to remember on the night. Both optional: rows
     * written before the photo wall existed read as "auto", never closing.
     *
     * "closed" is retired — it was a manual switch before the closing time
     * existed — and stays accepted so a row that still holds it validates.
     * src/lib/settings.ts reads it as "auto" with no closing time.
     */
    photoWall: v.optional(
      v.union(v.literal("auto"), v.literal("open"), v.literal("closed"))
    ),
    photoWallClosesISO: v.optional(v.string()),

    updatedAt: v.number(),
  }).index("by_singleton", ["singleton"]),

  /**
   * One guest-uploaded photo.
   *
   * The original lives in the hosts' Google Drive and is never read back by
   * the site; `driveFileId` is kept so a host delete can remove it. What the
   * wall shows is the web copy in Convex storage, made on the guest's phone.
   *
   * `uploaderId` is the random id from that device's cookie. It is the only
   * link between a photo and the phone that added it, so it must never be
   * returned to a browser: anyone holding it could hide that device's photos.
   * The wall query answers `mine: true` instead.
   */
  photos: defineTable({
    status: v.union(v.literal("live"), v.literal("hidden")),
    uploaderId: v.string(),
    uploaderName: v.optional(v.string()),

    webStorageId: v.id("_storage"),
    // Pixel size of the web copy, so the wall can lay rows out before the
    // image bytes arrive.
    width: v.number(),
    height: v.number(),
    webBytes: v.number(),

    driveFileId: v.optional(v.string()),
    originalName: v.optional(v.string()),
    originalBytes: v.optional(v.number()),

    hiddenAt: v.optional(v.number()),
    hiddenBy: v.optional(v.union(v.literal("guest"), v.literal("host"))),
  })
    // Convex appends _creationTime, so this orders live (or hidden) photos by
    // time without touching the other status. "All", for the hosts, walks the
    // built-in creation-time index instead.
    .index("by_status", ["status"]),

  /**
   * How many photos are live and hidden. Convex has no count operator, and
   * the wall header and the host filter both show these; kept in step by
   * every photo write in the same transaction, like `rsvpTotals`.
   */
  photoTotals: defineTable({
    singleton: v.literal("photos"),
    live: v.number(),
    hidden: v.number(),
  }).index("by_singleton", ["singleton"]),

  /**
   * The hosts' Google Drive, connected once from Settings.
   *
   * `refreshTokenSealed` is encrypted by the Next.js server with a key derived
   * from AUTH_SECRET before it gets here (see src/lib/seal.ts), so a copy of
   * the database alone cannot reach the Drive. The app only ever holds the
   * `drive.file` scope, which reaches files it created and nothing else.
   */
  driveConnection: defineTable({
    singleton: v.literal("drive"),
    account: v.string(),
    folderId: v.string(),
    folderName: v.string(),
    folderUrl: v.string(),
    refreshTokenSealed: v.string(),
    connectedAt: v.number(),
  }).index("by_singleton", ["singleton"]),

  /**
   * Running totals over `rsvps`, kept in step with every write to that table
   * inside the same transaction. The dashboard needs counts and sums, and
   * Convex has no count operator: reading the whole table to add it up is
   * fine at ten replies and hits the read limit at ten thousand.
   *
   * Absent until `rebuildTotals` has run once. That absence is meaningful —
   * see `adjustTotals` in rsvps.ts.
   */
  rsvpTotals: defineTable({
    singleton: v.literal("totals"),

    responses: v.number(),
    attendingParties: v.number(),
    adults: v.number(),
    kids: v.number(),
    withDietaryNotes: v.number(),

  }).index("by_singleton", ["singleton"]),

  /**
   * How many adults chose each meal — one document per meal.
   *
   * Not a field on the totals row. Every RSVP write patches that row, so
   * anything stored there has to stay small for ever; a list of meals that
   * grows would eventually pass the document size limit and take every RSVP
   * down with it. Capping the list instead only moved the failure: a meal past
   * the cap was silently missing from the catering numbers the hosts order
   * food against.
   *
   * A document each has neither problem. One meal's count is one small row, a
   * write touches only the meals that changed, and a row is deleted once
   * nobody has that meal left.
   */
  mealTallies: defineTable({
    meal: v.string(),
    count: v.number(),
  }).index("by_meal", ["meal"]),

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
