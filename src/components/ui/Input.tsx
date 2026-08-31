import type { ComponentProps } from "react";

/** One control surface, shared by input, textarea and select. */
const CONTROL =
  "w-full rounded-md border border-border-field bg-surface px-3.5 py-2.5 text-[0.95rem] " +
  "text-ink transition-colors placeholder:text-ink-subtle " +
  "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${CONTROL} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${CONTROL} resize-y ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${CONTROL} ${className}`} {...props} />;
}

export function Checkbox({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded-xs accent-accent ${className}`}
      {...props}
    />
  );
}

export function FieldError({ id, prefix, children }: { id: string; prefix: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-danger">
      <span className="sr-only">{prefix} </span>
      {children}
    </p>
  );
}
