/**
 * CSV cells, safe to hand to a spreadsheet.
 *
 * Kept out of the export route so the escaping can be tested directly: it is
 * the only thing standing between a guest's free-text name and a formula
 * running on the hosts' machine when they open the file.
 */

/**
 * A leading =, +, -, @, tab or carriage return makes Excel and LibreOffice
 * treat a cell as a formula. Quoting does not stop it — the quotes are the
 * CSV layer, stripped before the value is interpreted.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Quote a value so commas, quotes and newlines survive, and no cell executes. */
export function csvCell(value: string | number | boolean | undefined | null): string {
  const raw = String(value ?? "");
  // A leading apostrophe is the spreadsheet's own "this is text" marker; it is
  // consumed when the file is opened rather than shown in the cell.
  const text = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}
