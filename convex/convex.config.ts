import { defineApp } from "convex/server";
import { v } from "convex/values";

/**
 * The deployment's configuration, declared so it is typed and so a missing
 * value is a deploy-time finding rather than a cron quietly doing nothing.
 *
 * ADMIN_API_KEY is the shared secret between this deployment and the site:
 * every function here checks it, and the tidy cron presents it back to the
 * site. SITE_URL is optional — the site records its own address (see
 * convex/site.ts) and this only overrides it.
 */
const app = defineApp({
  env: {
    ADMIN_API_KEY: v.string(),
    SITE_URL: v.optional(v.string()),
  },
});

export default app;
