import { Card } from "./Surface";

export type StatItem = {
  label: string;
  value: number | string;
};

/**
 * A group of related figures under one heading.
 *
 * Six separate cards gave every number the same weight and made the eye work
 * to see which belonged together. Grouping them says what the numbers are
 * counting — people in one, replies in the other.
 */
export function StatGroup({
  label,
  items,
}: {
  label: string;
  items: StatItem[];
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </p>

      <dl className="mt-3 flex divide-x divide-border">
        {items.map((item, index) => (
          // flex-col-reverse keeps the markup as term-then-value while showing
          // the number above its label.
          <div
            key={item.label}
            className={`flex flex-1 flex-col-reverse ${index === 0 ? "pr-4" : "px-4"}`}
          >
            <dt className="mt-1.5 text-xs text-ink-muted">{item.label}</dt>
            <dd className="font-display text-3xl leading-none tabular-nums text-ink">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
