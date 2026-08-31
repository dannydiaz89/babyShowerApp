"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { MoreIcon } from "./Icon";
import { cardClass } from "./Surface";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
};

/**
 * A per-row actions menu.
 *
 * Rendered through a portal with fixed positioning: the table sits inside a
 * horizontally scrolling container, and an absolutely positioned menu would be
 * clipped by it. Keyboard support is the point of building this rather than
 * using a bare list — arrow keys move between items, Escape closes and returns
 * focus to the trigger.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Position against the trigger before paint, so it never appears misplaced.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    // Scrolling or resizing would leave the menu stranded away from its row.
    const onReflow = () => close(false);

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const focusables = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []
    );
    const index = focusables.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusables[(index + 1) % focusables.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusables[(index - 1 + focusables.length) % focusables.length]?.focus();
    }
  }

  return (
    <>
      <IconButton
        ref={triggerRef}
        tone="neutral"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <MoreIcon />
      </IconButton>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              style={{ top: position.top, right: position.right }}
              className={`${cardClass} fixed z-50 min-w-40 overflow-hidden p-1 shadow-overlay`}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                  className={`block w-full rounded-sm px-3 py-2.5 text-left text-sm transition-colors ${
                    item.tone === "danger"
                      ? "text-danger hover:bg-danger-soft"
                      : "text-ink hover:bg-surface-sunken"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
