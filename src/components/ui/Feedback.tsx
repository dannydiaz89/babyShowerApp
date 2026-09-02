import type { ComponentProps, ElementType } from "react";

type Tone = "positive" | "critical" | "neutral";

const ALERT_TONES: Record<Tone, string> = {
  positive: "border-success bg-success-soft text-success",
  critical: "border-danger bg-danger-soft text-danger",
  neutral: "border-border bg-surface-sunken text-ink-muted",
};

export function Alert({
  tone = "neutral",
  className = "",
  ...props
}: ComponentProps<"div"> & { tone?: Tone }) {
  return (
    <div
      className={`rounded-md border px-3.5 py-2.5 text-sm ${ALERT_TONES[tone]} ${className}`}
      {...props}
    />
  );
}

const BADGE_TONES: Record<Tone, string> = {
  positive: "bg-success-soft text-success",
  critical: "bg-danger-soft text-danger",
  neutral: "bg-surface-sunken text-ink-muted",
};

/** A small squared tag for state — not a pill. */
export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={`inline-block rounded-sm px-2 py-1 text-xs ${BADGE_TONES[tone]} ${className}`}
      {...props}
    />
  );
}

/**
 * A notice that invites rather than warns: the day-of photo banner. One
 * tone, gold, because it is the one place the palette's warmth is allowed
 * to carry a message. Not an Alert — those report the outcome of something
 * the reader did; this asks them to do something.
 */
export function Callout({
  as: Tag = "div",
  icon,
  className = "",
  children,
  ...props
}: ComponentProps<"div"> & { as?: ElementType; icon?: React.ReactNode }) {
  return (
    <Tag
      className={`flex items-start gap-3.5 rounded-lg border border-gold/40 bg-gold-soft px-4 py-4 sm:px-5 ${className}`}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-gold">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </Tag>
  );
}
