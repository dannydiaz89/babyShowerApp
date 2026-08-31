/**
 * Verifies every text/background pair the app actually renders against the
 * WCAG AA floor (4.5:1), and UI component boundaries against 3:1.
 *
 * Token values are read straight out of globals.css, so this cannot drift
 * from the theme. Run with: pnpm check:contrast
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const T = Object.fromEntries(
  [...css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
);

const luminance = (hex) => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, where it renders, floor] */
const PAIRS = [
  ...["canvas", "surface", "surface-sunken", "accent-soft", "danger-soft", "success-soft"].flatMap((bg) =>
    ["ink", "ink-muted", "accent", "accent-ink", "gold-ink"].map((fg) => [fg, bg, "body text", 4.5]),
  ),
  // Status colours must hold on their own tag ground and on every page surface.
  ...["success-soft", "canvas", "surface", "surface-sunken"].map((bg) => [
    "success", bg, "attending tag", 4.5,
  ]),
  // Placeholders only ever sit on a field: surface normally, danger-soft when invalid.
  ["ink-subtle", "surface", "placeholder", 4.5],
  ["ink-subtle", "danger-soft", "placeholder, invalid field", 4.5],
  ["on-accent", "accent", "primary button", 4.5],
  ["on-accent", "accent-hover", "primary button, hover", 4.5],
  ...["canvas", "surface", "surface-sunken", "danger-soft"].map((bg) => ["danger", bg, "error text", 4.5]),
  // WCAG 1.4.11: a field's edge is the only thing marking where it begins.
  ["border-field", "surface", "field boundary", 3],
];

let failures = 0;
const rows = PAIRS.map(([fg, bg, where, floor]) => {
  const r = ratio(T[fg], T[bg]);
  const ok = r >= floor;
  if (!ok) failures += 1;
  return `${ok ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)}  (min ${floor})  ${fg} on ${bg} — ${where}`;
});

console.log(rows.sort().join("\n"));
console.log(
  failures === 0
    ? `\nAll ${PAIRS.length} pairs clear their floor.`
    : `\n${failures} of ${PAIRS.length} pairs FAIL.`,
);
process.exit(failures === 0 ? 0 : 1);
