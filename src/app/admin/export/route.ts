import { api } from "../../../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";

export const dynamic = "force-dynamic";

/** Wrap a value so commas, quotes and newlines survive the round trip. */
function csvCell(value: string | number | boolean | undefined): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

const columns = [
  "Name",
  "Email",
  "Phone",
  "Attending",
  "Adults",
  "Children",
  "Party total",
  "Guest names",
  "Meal",
  "Dietary notes",
  "Message",
  "Submitted",
  "Last updated",
];

export async function GET() {
  const rsvps = await convexClient().query(api.rsvps.list, { key: convexKey() });

  const rows = rsvps.map((r) =>
    [
      r.name,
      r.email,
      r.phone,
      r.attending ? "Yes" : "No",
      r.adults,
      r.kids,
      r.adults + r.kids,
      r.guestNames,
      r.meal,
      r.dietaryNotes,
      r.message,
      new Date(r.submittedAt).toISOString(),
      new Date(r.updatedAt).toISOString(),
    ]
      .map(csvCell)
      .join(",")
  );

  const csv = [columns.map(csvCell).join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="baby-shower-rsvps.csv"',
      // This file is the entire guest list. Never let it sit in a cache.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
