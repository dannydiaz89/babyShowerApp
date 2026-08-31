import type { ComponentProps } from "react";

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
