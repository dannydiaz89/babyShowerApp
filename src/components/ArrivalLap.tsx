"use client";

import { useState } from "react";
import { Moon } from "@/components/Moon";
import { Orion } from "@/components/Orion";

/**
 * The gate's mark: an Orion flies one lap around the crescent when the page
 * loads. Tapping the moon sends it around again — an easter egg, so it carries
 * no visible affordance, only an accessible name for anyone who lands on it.
 *
 * Bumping `run` remounts the craft, which is what restarts a CSS animation;
 * toggling class names leaves the previous animation mid-flight.
 *
 * Once `played` is set the lap runs even under prefers-reduced-motion. That is
 * deliberate: the preference exists to stop motion nobody asked for, and a tap
 * on the moon is asking. Until then, reduced motion gets a parked spacecraft
 * and no movement at all — see the media query in globals.css.
 */
export function ArrivalLap({ replayLabel }: { replayLabel: string }) {
  const [run, setRun] = useState(0);

  return (
    <div className="relative mx-auto flex h-32 w-full items-center justify-center">
      <div className="arrival" aria-hidden="true" data-played={run > 0 ? "true" : "false"}>
        <svg
          key={`trace-${run}`}
          className="arrival-trace"
          width="100%"
          height="100%"
          viewBox="0 0 264 124"
        >
          <ellipse cx="132" cy="62" rx="112" ry="44" />
        </svg>
        <div key={`craft-${run}`} className="arrival-craft">
          <Orion className="h-full w-full" />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        title={replayLabel}
        className="arrival-replay relative z-10 rounded-sm"
      >
        <Moon className="h-11 w-11 text-accent" />
        <span className="sr-only">{replayLabel}</span>
      </button>
    </div>
  );
}
