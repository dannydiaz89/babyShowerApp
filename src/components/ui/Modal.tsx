"use client";

import type { RefObject } from "react";
import { IconButton } from "./Button";
import { CloseIcon } from "./Icon";
import { cardClass } from "./Surface";
import { SectionTitle } from "./Typography";

/**
 * The one dialog shell.
 *
 * Three ways out, because a modal that traps you is the most annoying thing a
 * UI can do: the close button, a click on the backdrop, and Escape (which the
 * native <dialog> handles for free).
 *
 * The padding lives on an inner wrapper rather than the dialog itself, so a
 * click landing in the dialog's own box is always the backdrop and never a
 * near-miss on the content.
 */
export function Modal({
  ref,
  title,
  titleId,
  closeLabel,
  onClose,
  className = "",
  children,
}: {
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  titleId: string;
  closeLabel: string;
  /** Runs whenever the dialog closes, however it was dismissed. */
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Only a backdrop click has the dialog itself as its target.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      /*
       * `open:flex` rather than `flex`: a bare display utility would beat the
       * user agent's `display: none` on a closed <dialog> and leave it on the
       * page permanently.
       */
      className={`${cardClass} m-auto max-h-[90dvh] flex-col p-0 shadow-overlay backdrop:bg-ink/40 open:flex ${className}`}
    >
      {/* Header stays put so the close button is reachable in a long record. */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
        <SectionTitle id={titleId}>{title}</SectionTitle>
        <IconButton
          tone="neutral"
          label={closeLabel}
          onClick={() => ref.current?.close()}
          className="-mr-2"
        >
          <CloseIcon />
        </IconButton>
      </div>

      <div className="overflow-y-auto px-6 pb-6 pt-5">{children}</div>
    </dialog>
  );
}
