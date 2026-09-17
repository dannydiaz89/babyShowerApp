// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";

/**
 * What happens to an answer after the hosts stop asking the question.
 *
 * `storedFields` names every column a reply owns so that a host clearing a
 * box really clears it. That is right for the dashboard and wrong for a guest
 * whose form no longer shows the field at all: without the distinction, the
 * first guest to come back and fix their headcount would quietly drop the
 * allergy note the kitchen is cooking around. These run the real mutations,
 * because the behaviour under test is what `patch` does to the document.
 */

const KEY = "test-server-key";
process.env.ADMIN_API_KEY = KEY;

const modules = import.meta.glob("../../convex/**/*.ts");

const REPLY = {
  name: "Marisol Reyes",
  email: "marisol@example.invalid",
  attending: true,
  adults: 2,
  kids: 1,
};

async function only(t: ReturnType<typeof convexTest>) {
  const page = await t.query(api.rsvps.page, {
    key: KEY,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(1);
  return page.page[0];
}

describe("an allergies question the hosts turned off", () => {
  it("keeps a note left while it was still being asked", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.rsvps.submit, {
      key: KEY,
      ...REPLY,
      dietaryNotes: "Severe tree nut allergy",
    });

    // The dashboard builds the totals once; from then on every write keeps
    // them current, which is the path this is really checking.
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    // The same guest, months later, correcting their headcount on a form that
    // no longer shows the field.
    const second = await t.mutation(api.rsvps.submit, {
      key: KEY,
      ...REPLY,
      adults: 3,
      askDietary: false,
    });

    expect(second.updated).toBe(true);
    const row = await only(t);
    expect(row.adults).toBe(3);
    expect(row.dietaryNotes).toBe("Severe tree nut allergy");

    // And the hosts' count of who to cook around still includes them.
    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.withDietaryNotes).toBe(1);
  });

  it("still lets a guest clear their own note while it is being asked", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.rsvps.submit, {
      key: KEY,
      ...REPLY,
      dietaryNotes: "Severe tree nut allergy",
    });
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });
    await t.mutation(api.rsvps.submit, { key: KEY, ...REPLY, askDietary: true });

    expect((await only(t)).dietaryNotes).toBeUndefined();
    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.withDietaryNotes).toBe(0);
  });

  it("still lets a host delete a note from the dashboard", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.rsvps.submit, {
      key: KEY,
      ...REPLY,
      dietaryNotes: "Severe tree nut allergy",
    });

    // The host edit dialog, saved with the box emptied. No askDietary: the
    // hosts are editing the record, not answering a question.
    const row = await only(t);
    await t.mutation(api.rsvps.update, { key: KEY, id: row._id, ...REPLY });

    expect((await only(t)).dietaryNotes).toBeUndefined();
  });
});
