"use client";

import { useState } from "react";
import { DateField, type DateFieldLabels } from "./DateField";
import { TimeField, type TimeFieldLabels } from "./TimeField";

/**
 * A "YYYY-MM-DDTHH:mm" value edited as a date and a time side by side. The two
 * halves are kept in one state so the form always submits a whole value, never
 * a date with no time or the reverse.
 */
export function DateTimeField({
  id,
  name,
  value,
  locale,
  dateLabels,
  timeLabels,
}: {
  id: string;
  name: string;
  value: string;
  locale: string;
  dateLabels: DateFieldLabels;
  timeLabels: TimeFieldLabels;
}) {
  const [date, setDate] = useState(() => value.split("T")[0] ?? "");
  const [time, setTime] = useState(() => value.split("T")[1] ?? "");

  // A time with no date is meaningless, so the combined value needs both.
  const combined = date && time ? `${date}T${time}` : date ? `${date}T00:00` : "";

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <DateField
          id={id}
          name={`${name}__date`}
          value={date}
          onChange={setDate}
          locale={locale}
          labels={dateLabels}
        />
        <TimeField
          id={`${id}-time`}
          name={`${name}__time`}
          value={time}
          onChange={setTime}
          locale={locale}
          labels={timeLabels}
        />
      </div>
      <input type="hidden" name={name} value={combined} />
    </>
  );
}
