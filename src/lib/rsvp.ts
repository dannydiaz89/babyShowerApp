/**
 * Shared RSVP shape and the rules for folding several into one.
 *
 * The preview is built on the client so the hosts see — and can correct —
 * exactly what will be saved. The server stores what they confirm rather than
 * re-deriving it, so there is no way for the two to disagree.
 */
export type RsvpRecord = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  attending: boolean;
  adults: number;
  kids: number;
  guestNames?: string;
  meal?: string;
  dietaryNotes?: string;
  message?: string;
  submittedAt: number;
  updatedAt: number;
};

export type MergePreview = {
  name: string;
  email: string;
  phone: string;
  attending: boolean;
  adults: number;
  kids: number;
  guestNames: string;
  meal: string;
  dietaryNotes: string;
  message: string;
};

/** First non-empty value, in the order given. */
function firstOf(rows: RsvpRecord[], pick: (r: RsvpRecord) => string | undefined): string {
  for (const row of rows) {
    const value = pick(row)?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Every distinct value, joined. Used for anything a guest wrote: dropping one
 * of two allergy notes or messages loses information the hosts need.
 */
function allOf(
  rows: RsvpRecord[],
  pick: (r: RsvpRecord) => string | undefined,
  join: string
): string {
  const seen: string[] = [];
  for (const row of rows) {
    const value = pick(row)?.trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen.join(join);
}

/**
 * What the merged record starts as. `keep` leads, so its answers win where a
 * single value has to be chosen.
 */
export function buildMergePreview(keep: RsvpRecord, others: RsvpRecord[]): MergePreview {
  const rows = [keep, ...others];

  return {
    name: keep.name,
    email: firstOf(rows, (r) => r.email),
    phone: firstOf(rows, (r) => r.phone),
    attending: keep.attending,
    /*
     * The largest party, never the sum: if one reply already counted the other
     * person, adding them would double the party. The hosts adjust this on the
     * review step when that isn't what happened.
     */
    adults: Math.max(1, ...rows.map((r) => r.adults)),
    kids: Math.max(0, ...rows.map((r) => r.kids)),
    guestNames: allOf(rows, (r) => r.guestNames, ", "),
    meal: firstOf(rows, (r) => r.meal),
    dietaryNotes: allOf(rows, (r) => r.dietaryNotes, "; "),
    message: allOf(rows, (r) => r.message, "\n\n"),
  };
}
