"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cardClass } from "./Surface";

/**
 * Anchors a floating panel to a trigger and handles every way out of it.
 *
 * Rendered through a portal: these appear inside table cells and scrolling
 * containers, which would otherwise clip an absolutely positioned panel.
 */
export function useAnchoredPanel(
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void
) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = panelRef.current?.offsetWidth ?? 280;

    // Flip to the left of the trigger rather than run off the screen, and
    // above it when there isn't room below.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    const height = panelRef.current?.offsetHeight ?? 0;
    const top =
      spaceBelow < height + 16 && rect.top > height + 16
        ? rect.top - height - 4
        : rect.bottom + 4;

    setPosition({ top, left });
  }, [open, triggerRef, panelRef]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        onDismiss();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    /*
     * Scrolling the page would strand the panel away from its trigger, so it
     * closes. Scrolling *inside* the panel must not — the time picker scrolls
     * its own columns to the selected value as it opens, and a capture-phase
     * listener sees that too, which closed the panel the instant it appeared.
     */
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onDismiss();
    };
    const onResize = () => onDismiss();

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onDismiss, panelRef, triggerRef]);

  return position;
}

export function Popover({
  panelRef,
  position,
  label,
  className = "",
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  position: { top: number; left: number };
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{ top: position.top, left: position.left }}
      className={`${cardClass} fixed z-50 shadow-overlay ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}
