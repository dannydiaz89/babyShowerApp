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

export function CameraIcon({ className = "h-5 w-5", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = "h-5 w-5", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "h-5 w-5", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function CheckIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function CopyIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function EyeIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M9.9 5.8A8.9 8.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9" />
      <path d="M6.5 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.5-.7" />
      <path d="M10 10a2.8 2.8 0 0 0 4 4" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function PlusIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A photograph: a frame with a horizon and a sun. */
export function PhotoIcon({ className = "h-5 w-5", ...props }: IconProps) {
  return (
    <svg {...BASE} className={className} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5l-4.5-4.5-7 7" />
    </svg>
  );
}
