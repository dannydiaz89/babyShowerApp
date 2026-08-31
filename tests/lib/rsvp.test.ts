import { describe, expect, it } from "vitest";
import { buildMergePreview, type RsvpRecord } from "@/lib/rsvp";

function rsvp(over: Partial<RsvpRecord> = {}): RsvpRecord {
  return {
    _id: "id1",
    name: "Elena Vargas",
    attending: true,
    adults: 1,
    kids: 0,
    submittedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("merging duplicate RSVPs", () => {
  it("keeps the chosen row's name and answer", () => {
    const keep = rsvp({ _id: "a", name: "Elena Vargas", attending: false });
    const other = rsvp({ _id: "b", name: "E. Vargas", attending: true });
    const merged = buildMergePreview(keep, [other]);
    expect(merged.name).toBe("Elena Vargas");
    // The host picked which row leads; its yes/no must not be overridden.
    expect(merged.attending).toBe(false);
  });

  it("fills a missing contact detail from the other row", () => {
    // The whole reason merging exists: one reply had a phone, the other an
    // email, and the merged record should carry both.
    const keep = rsvp({ _id: "a", phone: "(562) 555-0177" });
    const other = rsvp({ _id: "b", email: "elena.vargas@example.com" });
    const merged = buildMergePreview(keep, [other]);
    expect(merged.phone).toBe("(562) 555-0177");
    expect(merged.email).toBe("elena.vargas@example.com");
  });

  it("prefers the kept row's contact detail when both have one", () => {
    const keep = rsvp({ _id: "a", email: "new@example.com" });
    const other = rsvp({ _id: "b", email: "old@example.com" });
    expect(buildMergePreview(keep, [other]).email).toBe("new@example.com");
  });

  it("treats a whitespace-only field as empty", () => {
    const keep = rsvp({ _id: "a", email: "   " });
    const other = rsvp({ _id: "b", email: "real@example.com" });
    expect(buildMergePreview(keep, [other]).email).toBe("real@example.com");
  });

  it("keeps every allergy note rather than only the first", () => {
    // Regression: dropping one of two dietary notes loses information the
    // hosts need to cater safely.
    const keep = rsvp({ _id: "a", dietaryNotes: "No shellfish" });
    const other = rsvp({ _id: "b", dietaryNotes: "Nut allergy" });
    expect(buildMergePreview(keep, [other]).dietaryNotes).toBe("No shellfish; Nut allergy");
  });

  it("keeps every message, separated so both stay readable", () => {
    const keep = rsvp({ _id: "a", message: "Wouldn't miss it." });
    const other = rsvp({ _id: "b", message: "Bringing the cake." });
    expect(buildMergePreview(keep, [other]).message).toBe(
      "Wouldn't miss it.\n\nBringing the cake."
    );
  });

  it("does not repeat a note both rows happen to share", () => {
    const keep = rsvp({ _id: "a", dietaryNotes: "Vegetarian" });
    const other = rsvp({ _id: "b", dietaryNotes: "Vegetarian" });
    expect(buildMergePreview(keep, [other]).dietaryNotes).toBe("Vegetarian");
  });

  it("takes the largest party, never the sum", () => {
    // A household reply that already counted both people must not be doubled
    // when the second person replies for themselves.
    const keep = rsvp({ _id: "a", adults: 2, kids: 1 });
    const other = rsvp({ _id: "b", adults: 1, kids: 0 });
    const merged = buildMergePreview(keep, [other]);
    expect(merged.adults).toBe(2);
    expect(merged.kids).toBe(1);
  });

  it("never produces a party of zero adults", () => {
    const keep = rsvp({ _id: "a", adults: 0, kids: 0 });
    expect(buildMergePreview(keep, [rsvp({ _id: "b", adults: 0 })]).adults).toBe(1);
  });

  it("folds three rows at once", () => {
    const merged = buildMergePreview(rsvp({ _id: "a", name: "Hector" }), [
      rsvp({ _id: "b", email: "b@example.com", dietaryNotes: "Gluten-free" }),
      rsvp({ _id: "c", phone: "5625550177", dietaryNotes: "No pork", adults: 3 }),
    ]);
    expect(merged.name).toBe("Hector");
    expect(merged.email).toBe("b@example.com");
    expect(merged.phone).toBe("5625550177");
    expect(merged.dietaryNotes).toBe("Gluten-free; No pork");
    expect(merged.adults).toBe(3);
  });

  it("returns empty strings, not undefined, for fields nobody filled in", () => {
    // The preview feeds a form; undefined would render as "undefined".
    const merged = buildMergePreview(rsvp({ _id: "a" }), [rsvp({ _id: "b" })]);
    expect(merged.email).toBe("");
    expect(merged.message).toBe("");
    expect(merged.meal).toBe("");
  });
});
