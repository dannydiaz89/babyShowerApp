"use client";

import { useState } from "react";
import { DateField, type DateFieldLabels } from "./DateField";
import { TimeField, type TimeFieldLabels } from "./TimeField";
import { FieldsetLabel } from "./Surface";

/**
 * A "YYYY-MM-DDTHH:mm" value edited as a date and a time side by side. The two
 * halves are kept in one state so the form always submits a whole value, never
 * a date with no time or the reverse.
 *
 * Two inputs cannot share one <label>, so this owns its own fieldset and
 * legend and names each half explicitly. A single label above the pair reads
 * as "Starts" on the date box and leaves the time box unnamed — a screen
 * reader then meets the same field twice with nothing to tell them apart.
 */
export function DateTimeField({
  id,
  name,
  legend,
  value,
  locale,
  dateLabels,
  timeLabels,
  dateFieldLabel,
  timeFieldLabel,
}: {
  id: string;
  name: string;
  /** The visible name of the pair, e.g. "Starts". */
  legend: string;
  value: string;
  locale: string;
  dateLabels: DateFieldLabels;
  timeLabels: TimeFieldLabels;
  /** Names the date half inside the group, e.g. "Date". */
  dateFieldLabel: string;
  /** Names the time half inside the group, e.g. "Time". */
  timeFieldLabel: string;
}) {
  const [date, setDate] = useState(() => value.split("T")[0] ?? "");
  const [time, setTime] = useState(() => value.split("T")[1] ?? "");

  // A time with no date is meaningless, so the combined value needs both.
  const combined = date && time ? `${date}T${time}` : date ? `${date}T00:00` : "";

  return (
    <fieldset>
      <FieldsetLabel>{legend}</FieldsetLabel>
      <div className="grid grid-cols-2 gap-2">
        <DateField
          id={id}
          name={`${name}__date`}
          value={date}
          onChange={setDate}
          locale={locale}
          labels={dateLabels}
          ariaLabel={dateFieldLabel}
        />
        <TimeField
          id={`${id}-time`}
          name={`${name}__time`}
          value={time}
          onChange={setTime}
          locale={locale}
          labels={timeLabels}
          ariaLabel={timeFieldLabel}
        />
      </div>
      <input type="hidden" name={name} value={combined} />
    </fieldset>
  );
}
