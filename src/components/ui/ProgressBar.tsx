/**
 * One progress treatment. Track in the sunken surface, fill in the accent,
 * and a real `progressbar` role so assistive tech reads the number rather
 * than a growing coloured bar.
 */
export function ProgressBar({
  value,
  label,
  className = "",
}: {
  /** 0 to 1. Anything outside is clamped. */
  value: number;
  /** What is progressing, for assistive tech. */
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`h-1.5 w-full overflow-hidden rounded-sm bg-surface-sunken ${className}`}
    >
      <div
        className="h-full rounded-sm bg-accent transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
