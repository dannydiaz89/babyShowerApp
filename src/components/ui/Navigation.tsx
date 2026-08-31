import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Active state is an underline, not a filled pill — it marks position without
 * competing with the buttons around it.
 */
export function NavLink({
  active = false,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { active?: boolean }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`border-b-2 px-1 pb-3 pt-2 text-sm transition-colors sm:pb-1 sm:pt-0 ${
        active
          ? "border-accent text-ink"
          : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}

/**
 * Two or more mutually exclusive choices, shown together so the current one is
 * visible rather than inferred. Squared, to match the rest of the system.
 */
export function SegmentedControl({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function Segment({
  selected = false,
  className = "",
  ...props
}: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`rounded-sm px-2.5 py-2.5 text-xs transition-colors sm:px-3 sm:py-1.5 ${
        selected
          ? "bg-accent-soft font-medium text-accent"
          : "text-ink-muted hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}

/** Section switcher. Underlined, so it reads as tabs without any pill shape. */
export function TabList({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex flex-wrap gap-x-5 gap-y-1 border-b border-border ${className}`}
    >
      {children}
    </div>
  );
}

export function Tab({
  selected = false,
  className = "",
  ...props
}: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={`-mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors ${
        selected
          ? "border-accent font-medium text-ink"
          : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}
