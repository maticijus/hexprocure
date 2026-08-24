import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
} from "./auth";

describe("password hashing", () => {
  it("hashes and verifies a password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const hash = hashPassword("secret");
    expect(verifyPassword("Secret", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("produces unique salts per hash", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
});

describe("session tokens", () => {
  const SECRET = "unit-test-secret";

  it("creates and verifies a valid token", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    const payload = verifySessionToken(token, SECRET);
    expect(payload).toMatchObject({ userId: "user-1" });
    expect(payload!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(3500);
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    expect(verifySessionToken(token, "other-secret")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken("user-1", SECRET, -10);
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects tampered payloads", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    const [payload] = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ userId: "admin", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${tampered}.${payload.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifySessionToken(`${payload}.deadbeef`, SECRET)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("garbage", SECRET)).toBeNull();
    expect(verifySessionToken("", SECRET)).toBeNull();
  });
});
