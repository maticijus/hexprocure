import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  type KeySet,
} from "./token-crypto";

const KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const KEY_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

const keys: KeySet = { current: KEY_A };

describe("token-crypto envelope", () => {
  it("round-trips a secret", () => {
    const env = encryptSecret("super-secret-access-token", keys);
    expect(env.startsWith("v1:")).toBe(true);
    expect(env).not.toContain("super-secret");
    const d = decryptSecret(env, keys);
    expect(d.plain).toBe("super-secret-access-token");
    expect(d.keyIndex).toBe(0);
  });

  it("produces different ciphertexts per call (random nonce)", () => {
    expect(encryptSecret("x", keys)).not.toBe(encryptSecret("x", keys));
  });

  it("rejects decryption with the wrong key", () => {
    const env = encryptSecret("x", keys);
    expect(() => decryptSecret(env, { current: KEY_B })).toThrow(/decrypt/i);
  });

  it("rejects tampered ciphertext", () => {
    const env = encryptSecret("x", keys);
    const parts = env.split(":");
    const buf = Buffer.from(parts[2], "base64");
    buf[0] ^= 0xff;
    parts[2] = buf.toString("base64");
    expect(() => decryptSecret(parts.join(":"), keys)).toThrow();
  });

  it("falls back to the previous key and reports its index", () => {
    const env = encryptSecret("legacy", { current: KEY_B });
    const d = decryptSecret(env, { current: KEY_A, previous: KEY_B });
    expect(d.plain).toBe("legacy");
    expect(d.keyIndex).toBe(1);
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptSecret("garbage", keys)).toThrow(/malformed/i);
    expect(() => decryptSecret("v1:onlytwo", keys)).toThrow(/malformed/i);
  });

  it("requires a configured key", () => {
    expect(() => encryptSecret("x", { current: undefined as unknown as string })).toThrow(
      /INTEGRATION_ENC_KEY/,
    );
  });
});
