import type { ComponentProps } from "react";

/**
 * Icons are decorative: the control that wraps them carries the accessible
 * name, so every icon is hidden from assistive tech.
 */
type IconProps = ComponentProps<"svg">;

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function TrashIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M3.5 6h17" />
      <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
      <path d="M18.5 6l-.8 13.1A2 2 0 0 1 15.7 21H8.3a2 2 0 0 1-2-1.9L5.5 6" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

export function PencilIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Three dots: the conventional "more actions for this row" mark. */
export function MoreIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </svg>
  );
}
