"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
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
 * The site's address is what the site itself last recorded (convex/site.ts)
 * or, if set, SITE_URL on the deployment. Neither yet — a fresh deployment
 * nobody has signed in to — means there is nothing to call, and this says
 * so once per run and does nothing.
 */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const site = process.env.SITE_URL || (await ctx.runQuery(internal.site.get, {}));
    const key = process.env.ADMIN_API_KEY;
    if (!site || !key) {
      console.log("Photo tidy skipped: the site has not recorded its address yet and SITE_URL is not set.");
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
