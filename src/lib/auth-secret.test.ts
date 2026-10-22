import { describe, it, expect, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { getAuthSecret } from "./auth-secret";

afterEach(() => vi.unstubAllEnvs());

const withSecret = (value: string | undefined) => {
  vi.stubEnv("AUTH_SECRET", value as string);
  if (value === undefined) delete process.env.AUTH_SECRET;
};

describe("getAuthSecret", () => {
  it("accepts a 32+ character random secret", () => {
    const secret = randomBytes(32).toString("hex");
    withSecret(secret);
    expect(getAuthSecret()).toBe(secret);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["8 characters", "abcd1234"],
    ["31 characters", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d"],
  ])("throws for %s", (_label, value) => {
    withSecret(value);
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
  });

  it.each([
    "change-me",
    "changeme",
    "secret",
    "password",
    "test-secret",
    "dev-secret-change-me",
    "CHANGE-ME",
  ])("throws for placeholder %s even padded past 32 characters", (value) => {
    withSecret(value);
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
    withSecret(value.padEnd(40, value));
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
  });

  it.each(["a".repeat(32), "0".repeat(64)])("throws for a single repeated character", (value) => {
    withSecret(value);
    expect(() => getAuthSecret()).toThrow(/repeated/);
  });

  it("error message tells the operator how to fix it", () => {
    withSecret("short");
    expect(() => getAuthSecret()).toThrow(/openssl rand -hex 32/);
  });
});
