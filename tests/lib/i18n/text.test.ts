import { describe, expect, it } from "vitest";
import {
  fill,
  pick,
  pickOptional,
  present,
  formatDateShort,
  formatTimeRange,
  contactLine,
} from "@/lib/i18n/text";

describe("fill", () => {
  it("substitutes named placeholders", () => {
    expect(fill("Text {name} or email {email}.", { name: "Sam", email: "s@x.com" }))
      .toBe("Text Sam or email s@x.com.");
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    expect(fill("Hi {who}", {})).toBe("Hi {who}");
  });

  it("accepts numbers", () => {
    expect(fill("in {minutes} minutes", { minutes: 15 })).toBe("in 15 minutes");
  });
});

describe("present", () => {
  it("treats blank and whitespace-only as absent", () => {
    // One definition of "the host left this empty", so optional fields all
    // hide the same way instead of rendering a labelled blank.
    expect(present("text")).toBe(true);
    expect(present("")).toBe(false);
    expect(present("   ")).toBe(false);
    expect(present(undefined)).toBe(false);
    expect(present(null)).toBe(false);
  });
});

describe("pick / pickOptional", () => {
  it("returns the reader's language when it is filled in", () => {
    expect(pick({ en: "Garden casual", es: "Informal de jardín" }, "es"))
      .toBe("Informal de jardín");
  });

  it("falls back to English when the Spanish is blank", () => {
    // Hosts are told they may leave the Spanish empty; Spanish readers then
    // see the English rather than nothing.
    expect(pick({ en: "Garden casual", es: "" }, "es")).toBe("Garden casual");
    expect(pick({ en: "Garden casual", es: "   " }, "es")).toBe("Garden casual");
  });

  it("returns null when the host filled in neither, so the caller can hide it", () => {
    expect(pickOptional({ en: "", es: "" }, "en")).toBeNull();
    expect(pickOptional(undefined, "en")).toBeNull();
    expect(pickOptional({ en: "Something", es: "" }, "es")).toBe("Something");
  });
});

describe("formatDateShort", () => {
  it("does not slip to the previous day in western time zones", () => {
    // A bare YYYY-MM-DD parses as UTC, which lands on the day before in the
    // Americas. The deadline must read as the date the host typed.
    expect(formatDateShort("2026-10-01", "en")).toBe("October 1, 2026");
  });

  it("formats in the reader's language", () => {
    expect(formatDateShort("2026-10-01", "es")).toContain("octubre");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDateShort("not-a-date", "en")).toBe("not-a-date");
  });
});

describe("formatTimeRange", () => {
  it("renders a start and end", () => {
    expect(formatTimeRange("2026-10-18T14:00", "2026-10-18T17:00", "en"))
      .toBe("2:00 PM – 5:00 PM");
  });

  it("renders only the start when no end time is set", () => {
    // Regression: this used to produce a dangling "2:00 PM – " on the page.
    const range = formatTimeRange("2026-10-18T14:00", "", "en");
    expect(range).toBe("2:00 PM");
    expect(range).not.toContain("–");
  });

  it("returns null when there is no usable start, so the line can be hidden", () => {
    expect(formatTimeRange("", "2026-10-18T17:00", "en")).toBeNull();
    expect(formatTimeRange("nonsense", "", "en")).toBeNull();
  });
});

describe("contactLine", () => {
  const templates = {
    both: "Lost the password? Text {name} or email {email}.",
    nameOnly: "Lost the password? Text {name}.",
    emailOnly: "Lost the password? Email {email}.",
  };

  it("uses both when the hosts gave both", () => {
    expect(contactLine(templates, "Sam", "sam@example.com"))
      .toBe("Lost the password? Text Sam or email sam@example.com.");
  });

  it("drops just the email half when only a name is set", () => {
    // Regression: removing the contact email should shorten the sentence, not
    // leave "Text Sam or email ." behind.
    expect(contactLine(templates, "Sam", undefined))
      .toBe("Lost the password? Text Sam.");
    expect(contactLine(templates, "Sam", "  ")).toBe("Lost the password? Text Sam.");
  });

  it("uses the email alone rather than hiding a usable contact", () => {
    expect(contactLine(templates, undefined, "sam@example.com"))
      .toBe("Lost the password? Email sam@example.com.");
  });

  it("returns null when the hosts gave neither, so nothing renders", () => {
    expect(contactLine(templates, undefined, undefined)).toBeNull();
    expect(contactLine(templates, "", "   ")).toBeNull();
  });
});
