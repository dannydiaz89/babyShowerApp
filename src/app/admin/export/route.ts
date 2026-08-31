import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Rows per Convex read. The whole export is assembled from these. */
const PAGE_SIZE = 500;

/**
 * Guard against a pager that never reports itself done. PAGE_SIZE × this is
 * far more replies than a baby shower will ever have.
 */
const MAX_PAGES = 200;

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
  const client = convexClient();
  const key = convexKey();

  const rows: string[] = [];
  let cursor: string | null = null;

  // Paged rather than read in one go: the table has no upper bound, and a
  // single unbounded read eventually exceeds Convex's per-query limit — at
  // which point the export stops working entirely instead of getting slower.
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    // Annotated because `cursor` is read back out of it, which TypeScript
    // would otherwise see as inferring the type from itself.
    const result: FunctionReturnType<typeof api.rsvps.page> = await client.query(
      api.rsvps.page,
      {
        key,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      }
    );

    for (const r of result.page) {
      rows.push(
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
    }

    if (result.isDone) break;
    cursor = result.continueCursor;
  }

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
