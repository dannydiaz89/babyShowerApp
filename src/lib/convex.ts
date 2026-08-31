import "server-only";
import { ConvexHttpClient } from "convex/browser";

/**
 * The only place the app talks to Convex. Keeping it server-side means the
 * deployment URL and the API key never reach the browser.
 */
export function convexClient() {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not set. Run `npx convex dev` and check .env.local.");
  }
  return new ConvexHttpClient(url);
}

export function convexKey(): string {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    throw new Error(
      "ADMIN_API_KEY is not set. It must match the value set on your Convex deployment."
    );
  }
  return key;
}
