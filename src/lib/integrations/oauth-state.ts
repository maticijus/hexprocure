import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_COOKIE = "hexprocure_oauth_state";
const STATE_TTL_SECONDS = 600;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Creates a CSRF state token + Set-Cookie pair for the OAuth redirect. */
export function createOAuthState(secret: string): { state: string; cookie: string } {
  const nonce = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const value = `${nonce}.${exp}`;
  return {
    state: `${value}.${sign(value, secret)}`,
    cookie: `${STATE_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`,
  };
}

/** Verifies the callback's ?state against the signed cookie. Single-use by contract:
 *  the caller clears the cookie after verification. */
export function verifyOAuthState(
  queryState: string | null,
  cookieHeader: string | null,
  secret: string,
): boolean {
  if (!queryState || !cookieHeader) return false;
  const expectedCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`));
  if (!expectedCookie) return false;

  const parts = queryState.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, sig] = parts;
  const value = `${nonce}.${expStr}`;

  const expectedSig = sign(value, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  if (Number(expStr) < Math.floor(Date.now() / 1000)) return false;

  // the query state must be exactly the value we stored in the cookie
  return value === expectedCookie.slice(STATE_COOKIE.length + 1);
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
