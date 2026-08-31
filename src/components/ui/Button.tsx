import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "quiet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-70 disabled:cursor-not-allowed",
  secondary:
    "border border-border bg-surface text-ink hover:bg-surface-sunken disabled:opacity-70",
  quiet: "text-ink-muted hover:text-ink",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-2.5 text-sm sm:py-1.5",
  md: "px-5 py-2.5 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "transition-colors";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** For real hyperlinks — downloads, external destinations. */
export function AnchorButton({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"a"> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}

/**
 * An icon-only control. The label is required and does double duty: it names
 * the button for assistive tech and shows as the hover tooltip, so the icon is
 * never the only thing telling you what it does.
 */
export function IconButton({
  label,
  tone = "danger",
  className = "",
  ...props
}: ComponentProps<"button"> & { label: string; tone?: "danger" | "neutral" }) {
  const hover =
    tone === "danger"
      ? "hover:bg-danger-soft hover:text-danger"
      : "hover:bg-surface-sunken hover:text-ink";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors ${hover} ${className}`}
      {...props}
    />
  );
}
