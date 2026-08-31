"use client";

import { useMemo, useRef, useState } from "react";
import { Popover, useAnchoredPanel } from "./Popover";
import { Input } from "./Input";
import {
  type DateParts,
  daysInMonth,
  firstWeekday,
  formatParts,
  fromISO,
  parseTyped,
  toISO,
} from "@/lib/date-parts";

/** Names come from fixed UTC dates, so server and client always agree. */
function useCalendarNames(locale: string) {
  return useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return {
      months: Array.from({ length: 12 }, (_, m) => short.format(Date.UTC(2021, m, 15))),
      monthsLong: Array.from({ length: 12 }, (_, m) => long.format(Date.UTC(2021, m, 15))),
      /*
       * Two letters, not one: a narrow weekday gives "S M T W T F S", where
       * Sunday/Saturday and Tuesday/Thursday are indistinguishable.
       * 2021-08-01 was a Sunday.
       */
      weekdays: Array.from({ length: 7 }, (_, d) =>
        weekday.format(Date.UTC(2021, 7, 1 + d)).slice(0, 2).toUpperCase()
      ),
    };
  }, [locale]);
}

export type DateFieldLabels = {
  open: string;
  clear: string;
  today: string;
  previousMonth: string;
  nextMonth: string;
  chooseMonth: string;
  monthHint: string;
  invalid: string;
};

export function DateField({
  id,
  name,
  value,
  onChange,
  locale,
  labels,
  ariaLabel,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  locale: string;
  labels: DateFieldLabels;
  /**
   * Names the input when no <label> points at it — a date paired with a time
   * under one legend, where the legend alone would leave both unnamed.
   */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pickingMonth, setPickingMonth] = useState(false);
  const [text, setText] = useState(() => formatParts(fromISO(value), locale));
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPanel(triggerRef, panelRef, open, () => setOpen(false));
  const names = useCalendarNames(locale);

  const selected = fromISO(value);
  const today = new Date();
  const [view, setView] = useState(() =>
    selected
      ? { year: selected.year, month: selected.month }
      : { year: today.getFullYear(), month: today.getMonth() }
  );

  // Typed but not a date we understand — flagged, and reverted on blur rather
  // than silently saving something wrong.
  const typedIsBroken = text.trim() !== "" && parseTyped(text, locale) === null;

  function commit(parts: DateParts | null) {
    onChange(parts ? toISO(parts) : "");
    setText(formatParts(parts, locale));
    if (parts) setView({ year: parts.year, month: parts.month });
  }

  function choose(parts: DateParts) {
    commit(parts);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const month = v.month + delta;
      if (month < 0) return { year: v.year - 1, month: 11 };
      if (month > 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month };
    });
  }

  const total = daysInMonth(view.year, view.month);
  const lead = firstWeekday(view.year, view.month);

  return (
    <>
      <div ref={triggerRef} className="relative">
        <Input
          id={id}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // Update the stored value as soon as what's typed makes sense.
            const parts = parseTyped(next, locale);
            if (parts) {
              onChange(toISO(parts));
              setView({ year: parts.year, month: parts.month });
            } else if (next.trim() === "") {
              onChange("");
            }
          }}
          onBlur={() => setText(formatParts(parseTyped(text, locale), locale))}
          aria-label={ariaLabel}
          aria-invalid={typedIsBroken || undefined}
          inputMode="numeric"
          autoComplete="off"
          className="pr-11"
        />
        <button
          type="button"
          aria-label={labels.open}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setPickingMonth(false);
            setOpen((was) => !was);
          }}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-accent transition-colors hover:bg-surface-sunken"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="h-4 w-4">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/*
        * Shown rather than left to blur: a host who types something odd and
        * goes straight to Save would otherwise see one date and store another,
        * because the stored value only moves when the text parses.
        */}
      {typedIsBroken ? (
        <p className="mt-1.5 text-xs text-danger">{labels.invalid}</p>
      ) : null}

      <input type="hidden" name={name} value={value} />

      {open ? (
        <Popover panelRef={panelRef} position={position} label={labels.open} className="w-[19rem]">
          <div className="flex items-center justify-between px-3 pt-3">
            <button
              type="button"
              aria-label={labels.previousMonth}
              onClick={() =>
                pickingMonth ? setView((v) => ({ ...v, year: v.year - 1 })) : shiftMonth(-1)
              }
              className="rounded-md px-2 py-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              &lsaquo;
            </button>
            <button
              type="button"
              onClick={() => setPickingMonth((was) => !was)}
              aria-label={labels.chooseMonth}
              className="rounded-md border border-transparent px-3 py-1 text-sm font-medium text-ink transition-colors hover:border-border"
            >
              {pickingMonth ? view.year : `${names.monthsLong[view.month]} ${view.year}`}{" "}
              <span aria-hidden="true" className="text-ink-muted">&#9662;</span>
            </button>
            <button
              type="button"
              aria-label={labels.nextMonth}
              onClick={() =>
                pickingMonth ? setView((v) => ({ ...v, year: v.year + 1 })) : shiftMonth(1)
              }
              className="rounded-md px-2 py-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              &rsaquo;
            </button>
          </div>

          {pickingMonth ? (
            <>
              <div className="grid grid-cols-3 gap-1 p-3">
                {names.months.map((label, month) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setView((v) => ({ ...v, month }));
                      setPickingMonth(false);
                    }}
                    className={`rounded-md px-2 py-3 text-sm transition-colors ${
                      month === view.month
                        ? "bg-surface-sunken font-medium text-ink"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="border-t border-border px-3 py-2.5 text-xs text-ink-muted">
                {labels.monthHint}
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 px-3 pt-3 text-center text-xs text-ink-muted">
                {names.weekdays.map((day, i) => (
                  <span key={i}>{day}</span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 p-3">
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} />
                ))}
                {Array.from({ length: total }, (_, i) => {
                  const day = i + 1;
                  const isSelected =
                    selected?.year === view.year &&
                    selected?.month === view.month &&
                    selected?.day === day;
                  const isToday =
                    today.getFullYear() === view.year &&
                    today.getMonth() === view.month &&
                    today.getDate() === day;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => choose({ year: view.year, month: view.month, day })}
                      aria-current={isSelected ? "date" : undefined}
                      className={`aspect-square rounded-md text-sm transition-colors ${
                        isSelected
                          ? "bg-accent font-medium text-on-accent"
                          : isToday
                            ? "border border-accent text-ink"
                            : "text-ink hover:bg-surface-sunken"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    commit(null);
                    setOpen(false);
                  }}
                  className="rounded-md px-2 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  {labels.clear}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    choose({
                      year: today.getFullYear(),
                      month: today.getMonth(),
                      day: today.getDate(),
                    })
                  }
                  className="rounded-md px-2 py-1.5 text-sm text-accent transition-colors hover:bg-accent-soft"
                >
                  {labels.today}
                </button>
              </div>
            </>
          )}
        </Popover>
      ) : null}
    </>
  );
}
