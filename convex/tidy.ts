"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Ask the site to tidy photo storage.
 *
 * The Drive folder and the site's stored copies are reconciled on the site,
 * not here: the Drive credentials are sealed under a secret only the site
 * holds. What Convex contributes is the clock — a cron that fires whether
 * or not anyone is loading pages, so an abandoned upload is cleaned up on
 * a quiet Tuesday as surely as on the day. It authenticates with the same
 * shared key the site uses to call Convex, the other way round.
 *
 * SITE_URL must be set on the deployment (`npx convex env set SITE_URL
 * https://…`); without it this logs once and does nothing.
 */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    const site = process.env.SITE_URL;
    const key = process.env.ADMIN_API_KEY;
    if (!site || !key) {
      console.log("Photo tidy skipped: SITE_URL or ADMIN_API_KEY is not set on this deployment.");
      return null;
    }
    try {
      const response = await fetch(new URL("/api/photos/tidy", site), {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(50_000),
      });
      const body = await response.text();
      console.log(`Photo tidy: ${response.status} ${body.slice(0, 200)}`);
    } catch (error) {
      console.error("Photo tidy failed", error);
    }
    return null;
  },
});
