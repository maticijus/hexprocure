import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM envelope encryption for OAuth tokens.
 *  Envelope format: "v1:<nonce_b64>:<ciphertext+authTag_b64>".
 *
 *  Key material lives in INTEGRATION_ENC_KEY (base64, 32 bytes) — deliberately
 *  separate from the session-signing secret so a session-secret leak cannot
 *  decrypt stored OAuth tokens. INTEGRATION_ENC_KEY_PREVIOUS enables rotation:
 *  reads try current then previous; writes always use current. */

export interface KeySet {
  current: string;
  previous?: string;
}

export interface DecryptResult {
  plain: string;
  keyIndex: number;
}

export function loadKeySetFromEnv(): KeySet {
  const current = process.env.INTEGRATION_ENC_KEY;
  if (!current) {
    throw new Error("INTEGRATION_ENC_KEY is not configured");
  }
  const previous = process.env.INTEGRATION_ENC_KEY_PREVIOUS || undefined;
  return { current, previous };
}

function keyBytes(keyB64: string): Buffer {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) {
    throw new Error("Encryption keys must decode to exactly 32 bytes");
  }
  return raw;
}

export function encryptSecret(plain: string, keys: KeySet): string {
  if (!keys?.current) {
    throw new Error("INTEGRATION_ENC_KEY is required to store secrets");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keys.current), nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${nonce.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

export function decryptSecret(envelope: string, keys: KeySet): DecryptResult {
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error(`Malformed secret envelope`);
  }
  const candidates = [keys.current, keys.previous].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  for (let i = 0; i < candidates.length; i++) {
    try {
      const nonce = Buffer.from(parts[1], "base64");
      const data = Buffer.from(parts[2], "base64");
      const decipher = createDecipheriv("aes-256-gcm", keyBytes(candidates[i]), nonce);
      const tag = data.subarray(data.length - 16);
      const ct = data.subarray(0, data.length - 16);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      return { plain, keyIndex: i };
    } catch {
      // try next key; fall through
    }
  }
  throw new Error("Failed to decrypt secret with any configured key");
}
