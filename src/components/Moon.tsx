/** A crescent moon used as a divider and as the gate's mark. Decorative only. */
export function Moon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <path
        d="M24 6a12 12 0 0 0 18 18 18 18 0 1 1-18-18Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
