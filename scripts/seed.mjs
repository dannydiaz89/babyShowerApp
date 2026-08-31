/**
 * Fill the dev database with sample RSVPs so the dashboard can be tried out
 * with something in it.
 *
 *   pnpm seed          add the sample guests
 *   pnpm seed:clear    remove them again
 *
 * Every sample row is tagged: emails use the reserved example.com domain and
 * phones use the 555-01xx range that is reserved for fiction. Clearing only
 * touches rows matching those, so a real RSVP can never be deleted by it.
 */
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";

const SAMPLE_EMAIL_DOMAIN = "@example.com";
const SAMPLE_PHONE_PREFIX = "(562) 555-01";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) {
    console.error("No .env.local found. Copy .env.example and fill it in first.");
    process.exit(1);
  }
  const env = Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).split(" #")[0].trim()];
      })
  );
  for (const key of ["CONVEX_URL", "ADMIN_API_KEY"]) {
    if (!env[key]) {
      console.error(`${key} is missing from .env.local.`);
      process.exit(1);
    }
  }
  return env;
}

/** Chosen to exercise every state the dashboard can show. */
const GUESTS = [
  {
    name: "Marisol Reyes",
    email: `marisol.reyes${SAMPLE_EMAIL_DOMAIN}`,
    phone: `${SAMPLE_PHONE_PREFIX}22`,
    attending: true,
    adults: 2,
    kids: 1,
    guestNames: "Javier Reyes, Lucía (3)",
    meal: "Vegetarian",
    dietaryNotes: "Severe tree nut allergy",
    message: "We are so happy for you both!",
  },
  {
    name: "Carmen Espana",
    email: `carmen.espana${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 1,
    kids: 0,
    meal: "No preference",
  },
  // No email at all — the case that prompted the phone fallback.
  {
    name: "Abuela Rosa",
    phone: `${SAMPLE_PHONE_PREFIX}09`,
    attending: true,
    adults: 1,
    kids: 0,
    message: "Ahí estaré, con muchos tamales.",
  },
  {
    name: "Tom & Priya Whitfield",
    email: `whitfield${SAMPLE_EMAIL_DOMAIN}`,
    attending: false,
    adults: 0,
    kids: 0,
    message: "So sorry — we'll be out of town that weekend. Sending love.",
  },
  {
    name: "Luis Diaz",
    email: `luis.diaz${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 3,
    kids: 2,
    guestNames: "Ana, Miguel, the twins (6)",
    meal: "Gluten-free",
    dietaryNotes: "One of the twins is coeliac",
  },
  {
    name: "Jenny Kwan",
    email: `jenny.kwan${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 2,
    kids: 0,
    meal: "Vegan",
    message: "Counting down!",
  },
  {
    name: "Uncle Ray",
    phone: `${SAMPLE_PHONE_PREFIX}44`,
    attending: false,
    adults: 0,
    kids: 0,
  },
  {
    name: "Sofia Nguyen",
    email: `sofia.nguyen${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 1,
    kids: 1,
    guestNames: "Mateo (18 months)",
    meal: "No preference",
  },
  // --- Two deliberate duplicates, so merging has something to work on ------
  // Same person, once by email and once by phone: no shared key, so these
  // stay separate until merged.
  {
    name: "Patricia Moreno",
    email: `patricia.moreno${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 1,
    kids: 0,
    message: "Wouldn't miss it.",
  },
  {
    name: "Patricia Moreno",
    phone: `${SAMPLE_PHONE_PREFIX}77`,
    attending: true,
    adults: 1,
    kids: 0,
    dietaryNotes: "No shellfish",
  },
  // A household counted twice: she booked for both, he booked for himself.
  {
    name: "Elena Vargas",
    email: `elena.vargas${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 2,
    kids: 0,
    guestNames: "Elena and Hector",
  },
  {
    name: "Hector Vargas",
    email: `hector.vargas${SAMPLE_EMAIL_DOMAIN}`,
    attending: true,
    adults: 1,
    kids: 0,
  },
];

const isSample = (row) =>
  (row.email ?? "").endsWith(SAMPLE_EMAIL_DOMAIN) ||
  (row.phone ?? "").startsWith(SAMPLE_PHONE_PREFIX);

const env = loadEnv();
const client = new ConvexHttpClient(env.CONVEX_URL);
const key = env.ADMIN_API_KEY;
const clearing = process.argv.includes("--clear");

/** Every stored RSVP, a page at a time — the query is paginated. */
async function readAll() {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await client.query("rsvps:page", {
      key,
      paginationOpts: { numItems: 500, cursor },
    });
    rows.push(...page.page);
    if (page.isDone) return rows;
    cursor = page.continueCursor;
  }
}

const existing = await readAll();
const samples = existing.filter(isSample);
const real = existing.length - samples.length;

if (clearing) {
  for (const row of samples) {
    await client.mutation("rsvps:remove", { id: row._id, key });
  }
  console.log(`Removed ${samples.length} sample RSVP${samples.length === 1 ? "" : "s"}.`);
} else {
  if (samples.length > 0) {
    console.log(`${samples.length} sample rows already present — refreshing them.`);
    for (const row of samples) {
      await client.mutation("rsvps:remove", { id: row._id, key });
    }
  }
  for (const guest of GUESTS) {
    await client.mutation("rsvps:submit", { key, ...guest });
  }
  console.log(`Added ${GUESTS.length} sample RSVPs.`);
  console.log("Two pairs are deliberate duplicates, for trying the merge flow:");
  console.log("  · Patricia Moreno — replied once by email, once by phone");
  console.log("  · Elena & Hector Vargas — she booked for both, he booked again");
}

const stats = await client.query("rsvps:stats", { key });
console.log(
  `\nNow: ${stats.responses} responses, ${stats.totalGuests} guests ` +
    `(${stats.adults} adults, ${stats.kids} children).`
);
if (real > 0) console.log(`${real} real RSVP${real === 1 ? "" : "s"} left untouched.`);
