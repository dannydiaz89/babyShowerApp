import type { ComponentProps, ElementType } from "react";

/** The h1 on interior pages. */
export function PageTitle({ className = "", ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={`font-display text-4xl font-light text-ink ${className}`}
      {...props}
    />
  );
}

/** Large display type — the invitation hero and confirmation moments. */
export function DisplayTitle({
  as: Tag = "h1",
  className = "",
  ...props
}: ComponentProps<"h1"> & { as?: ElementType }) {
  return (
    <Tag
      className={`font-display font-light leading-[1.1] text-ink ${className}`}
      {...props}
    />
  );
}

export function SectionTitle({
  as: Tag = "h2",
  className = "",
  ...props
}: ComponentProps<"h2"> & { as?: ElementType }) {
  return (
    <Tag className={`font-display text-2xl font-light text-ink ${className}`} {...props} />
  );
}
