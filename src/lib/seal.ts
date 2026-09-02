/**
 * Encrypt a small secret for storage.
 *
 * Used for the Google Drive refresh token, which has to live somewhere the
 * server can read it back — the database — but which would hand anyone who
 * copied that database the hosts' Drive folder. Sealing it under a key
 * derived from AUTH_SECRET means the database alone is not enough; the
 * environment is needed too, and that is where the site's other secrets
 * already live.
 *
 * AES-GCM with a fresh 96-bit nonce per seal, via Web Crypto so it runs the
 * same in Node, on the Edge runtime and in tests. The output is
 * "v1.<nonce>.<ciphertext>", base64url, so a later scheme can sit beside it.
 */

const VERSION = "v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    // Built this way rather than with Uint8Array.from so the result is backed
    // by a plain ArrayBuffer, which is what Web Crypto's signature asks for.
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The key is a hash of the secret under a fixed label, so the same
 * AUTH_SECRET that signs cookies yields a different key here — a leak of
 * one derivation says nothing about the other.
 */
async function keyFor(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`photo-wall-seal:${secret}`)
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(plaintext: string, secret: string): Promise<string> {
  if (!secret) throw new Error("A secret is required to seal.");
  const key = await keyFor(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${VERSION}.${toBase64Url(nonce)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** The plaintext, or null if the value was not sealed under this secret. */
export async function open(sealed: string, secret: string): Promise<string | null> {
  if (!secret) return null;
  const [version, nonceText, cipherText, ...rest] = sealed.split(".");
  if (version !== VERSION || rest.length > 0 || !nonceText || !cipherText) return null;

  const nonce = fromBase64Url(nonceText);
  const ciphertext = fromBase64Url(cipherText);
  if (!nonce || !ciphertext || nonce.length !== 12) return null;

  try {
    const key = await keyFor(secret);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    // Wrong secret or a tampered value; GCM refuses both the same way.
    return null;
  }
}
