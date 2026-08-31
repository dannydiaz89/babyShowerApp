/**
 * Convex functions are reachable by anyone who knows the deployment URL, so
 * every function requires a shared key that only the Next.js server holds.
 * The browser never talks to Convex directly.
 */
export function assertServer(key: string) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) throw new Error("ADMIN_API_KEY is not set on the Convex deployment.");

  // Constant-time compare, so a wrong key can't be discovered byte by byte.
  if (key.length !== expected.length) throw new Error("Not authorized.");
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new Error("Not authorized.");
}
