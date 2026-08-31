"use client";

import { useEffect, useRef, useState } from "react";
import { Popover, useAnchoredPanel } from "./Popover";
import { Input } from "./Input";

/** Value is 24-hour "HH:mm"; the picker shows 12-hour columns. */
function parse(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour24 = Math.min(23, +match[1]);
  const minute = Math.min(59, +match[2]);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute,
    meridiem: hour24 < 12 ? "AM" : "PM",
  };
}

/**
 * Read what the host typed. Accepts "3:00 PM", "3pm", "15:00", "1530" and the
 * Spanish "p. m." that Intl produces, so the field takes back whatever it
 * showed as well as the obvious shorthands.
 */
function parseTyped(text: string): string | null {
  const cleaned = text.trim().toLowerCase().replace(/[.\s]/g, "");
  if (!cleaned) return null;

  const match = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(cleaned);
  if (!match) return null;

  let hour = +match[1];
  const minute = match[2] ? +match[2] : 0;
  const meridiem = match[3];

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatValue(value: string, locale: string): string {
  if (!parse(value)) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2021, 0, 1, +value.slice(0, 2), +value.slice(3, 5)));
}

function toValue(hour12: number, minute: number, meridiem: string) {
  const hour24 = meridiem === "AM" ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function Column({
  items,
  isSelected,
  onSelect,
  label,
  format,
}: {
  items: (number | string)[];
  isSelected: (item: number | string) => boolean;
  onSelect: (item: number | string) => void;
  label: string;
  format: (item: number | string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * Open with the current value in view. Sets scrollTop directly rather than
   * calling scrollIntoView, which also scrolls every ancestor — including the
   * page behind the popover.
   */
  useEffect(() => {
    const list = ref.current;
    const active = list?.querySelector<HTMLElement>("[data-selected='true']");
    if (!list || !active) return;
    list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
  }, []);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="max-h-56 flex-1 overflow-y-auto p-1"
    >
      {items.map((item) => {
        const selected = isSelected(item);
        return (
          <button
            key={String(item)}
            type="button"
            role="option"
            aria-selected={selected}
            data-selected={selected}
            onClick={() => onSelect(item)}
            className={`block w-full rounded-md px-3 py-2.5 text-center text-sm transition-colors ${
              selected
                ? "bg-accent font-medium text-on-accent"
                : "text-ink hover:bg-surface-sunken"
            }`}
          >
            {format(item)}
          </button>
        );
      })}
    </div>
  );
}

export type TimeFieldLabels = {
  open: string;
  hours: string;
  minutes: string;
  meridiem: string;
  invalid: string;
};

export function TimeField({
  id,
  name,
  value,
  onChange,
  locale,
  labels,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  locale: string;
  labels: TimeFieldLabels;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatValue(value, locale));
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPanel(triggerRef, panelRef, open, () => setOpen(false));

  const parts = parse(value);

  // Typed but not a time we understand — flagged, and reverted on blur rather
  // than silently saving something wrong.
  const typedIsBroken = text.trim() !== "" && parseTyped(text) === null;

  function set(hour12: number, minute: number, meridiem: string) {
    const next = toValue(hour12, minute, meridiem);
    onChange(next);
    setText(formatValue(next, locale));
  }

  return (
    <>
      <div ref={triggerRef} className="relative">
        <Input
          id={id}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const parsed = parseTyped(next);
            if (parsed) onChange(parsed);
            else if (next.trim() === "") onChange("");
          }}
          onBlur={() => {
            const parsed = parseTyped(text);
            setText(parsed ? formatValue(parsed, locale) : "");
          }}
          aria-invalid={typedIsBroken || undefined}
          autoComplete="off"
          className="pr-11"
        />
        <button
          type="button"
          aria-label={labels.open}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-accent transition-colors hover:bg-surface-sunken"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="h-4 w-4">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {typedIsBroken ? (
        <p className="mt-1.5 text-xs text-danger">{labels.invalid}</p>
      ) : null}

      <input type="hidden" name={name} value={value} />

      {open ? (
        <Popover panelRef={panelRef} position={position} label={labels.open} className="flex w-[15rem]">
          <Column
            label={labels.hours}
            items={HOURS}
            isSelected={(h) => h === (parts?.hour12 ?? 12)}
            onSelect={(h) => set(Number(h), parts?.minute ?? 0, parts?.meridiem ?? "AM")}
            format={(h) => String(h).padStart(2, "0")}
          />
          <Column
            label={labels.minutes}
            items={MINUTES}
            isSelected={(m) => m === (parts?.minute ?? 0)}
            onSelect={(m) => set(parts?.hour12 ?? 12, Number(m), parts?.meridiem ?? "AM")}
            format={(m) => String(m).padStart(2, "0")}
          />
          <Column
            label={labels.meridiem}
            items={["AM", "PM"]}
            isSelected={(p) => p === (parts?.meridiem ?? "AM")}
            onSelect={(p) => set(parts?.hour12 ?? 12, parts?.minute ?? 0, String(p))}
            format={(p) => String(p)}
          />
        </Popover>
      ) : null}
    </>
  );
}
