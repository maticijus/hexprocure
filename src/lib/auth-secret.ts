const MIN_LENGTH = 32;
const DENYLIST = ["change-me", "changeme", "secret", "password", "test-secret"];
const HINT = "generate one with: openssl rand -hex 32";

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error(`AUTH_SECRET is not set; ${HINT}`);
  if (secret.length < MIN_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_LENGTH} characters; ${HINT}`);
  }
  const lower = secret.toLowerCase();
  if (DENYLIST.some((bad) => lower.includes(bad))) {
    throw new Error(`AUTH_SECRET is a known placeholder; ${HINT}`);
  }
  if (new Set(secret).size === 1) {
    throw new Error(`AUTH_SECRET is a single repeated character; ${HINT}`);
  }
  return secret;
}
