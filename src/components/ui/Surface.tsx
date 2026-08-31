import type { ComponentProps, ElementType } from "react";

/**
 * The one card surface. `cardClass` is exported for the cases that need a
 * different element with its own props (an <a>, a <form>) — so those still
 * come from here rather than re-deriving the look.
 */
export const cardClass = "rounded-xl border border-border bg-surface shadow-raised";

export function Card({
  as: Tag = "div",
  className = "",
  ...props
}: ComponentProps<"div"> & { as?: ElementType }) {
  return <Tag className={`${cardClass} ${className}`} {...props} />;
}

/**
 * One small-caps treatment, three semantic wrappers. Sharing the class string
 * is the point: a form label, a fieldset legend and a card heading should look
 * identical without any of them redefining it.
 */
const OVERLINE = "text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted";

/** For form controls only — renders a real <label>. */
export function Label({ className = "", ...props }: ComponentProps<"label">) {
  return <label className={`mb-1.5 block ${OVERLINE} ${className}`} {...props} />;
}

/** For grouped controls — renders a <legend>. */
export function FieldsetLabel({ className = "", ...props }: ComponentProps<"legend">) {
  return <legend className={`mb-1.5 ${OVERLINE} ${className}`} {...props} />;
}

/** Same look, but for headings and captions that label content, not inputs. */
export function Overline({
  as: Tag = "p",
  className = "",
  ...props
}: ComponentProps<"p"> & { as?: ElementType }) {
  return <Tag className={`${OVERLINE} ${className}`} {...props} />;
}

export function Hint({ className = "", ...props }: ComponentProps<"p">) {
  return <p className={`mt-1 text-xs text-ink-muted ${className}`} {...props} />;
}

export function Eyebrow({ className = "", ...props }: ComponentProps<"p">) {
  return (
    <p
      className={`text-xs font-semibold uppercase tracking-[0.28em] text-accent-ink ${className}`}
      {...props}
    />
  );
}

/** A hairline rule with a mark in the middle. */
export function OrnamentRule({ children }: { children?: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-4 text-accent-line">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
