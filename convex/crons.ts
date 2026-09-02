import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Tidy photo storage — the Drive folder and the site's stored copies — every
// ten minutes, whether or not anyone is using the site. See convex/tidy.ts.
crons.interval("tidy photo storage", { minutes: 10 }, internal.tidy.run, {});

export default crons;
