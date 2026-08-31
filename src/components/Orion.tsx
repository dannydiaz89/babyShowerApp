/**
 * Orion in three-quarter view — the capsule read as a shield, four segmented
 * solar arrays spread around it. Drawn in the moon's line so the two belong to
 * one set. Decorative only.
 *
 * Three fill weights do the work at small sizes: the arrays sit lightest, the
 * service module mid, the capsule heaviest, so the capsule stays the head of
 * the craft once the outlines start to merge.
 */

const ARRAY_ANGLES = [52, 128, 232, 308];
const ARRAY_LENGTH = 17;
const ARRAY_WIDTH = 4.2;

/** One solar array, drawn along +x from the hub and split into three panels. */
function Array_({ angle }: { angle: number }) {
  const half = ARRAY_WIDTH / 2;
  const third = 9 + ARRAY_LENGTH / 3;
  const twoThirds = 9 + (ARRAY_LENGTH * 2) / 3;
  return (
    <g transform={`rotate(${angle})`}>
      <rect x={9} y={-half} width={ARRAY_LENGTH} height={ARRAY_WIDTH} rx={0.8} />
      <path
        d={`M${third.toFixed(2)} ${-half}v${ARRAY_WIDTH}M${twoThirds.toFixed(2)} ${-half}v${ARRAY_WIDTH}`}
        fill="none"
        strokeWidth="1.3"
      />
    </g>
  );
}

export function Orion({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        <g transform="translate(24 32)" fill="currentColor" fillOpacity="0.16">
          {ARRAY_ANGLES.map((angle) => (
            <Array_ key={angle} angle={angle} />
          ))}
        </g>
        <rect
          x="12"
          y="23.5"
          width="15"
          height="17"
          rx="2.5"
          fill="currentColor"
          fillOpacity="0.22"
        />
        <path
          d="M27 20q13 4.5 16.5 12Q40 39.5 27 44q-4.5-5.5-4.5-12T27 20Z"
          fill="currentColor"
          fillOpacity="0.34"
        />
      </g>
    </svg>
  );
}
