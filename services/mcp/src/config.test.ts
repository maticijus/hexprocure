import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads the env, strips trailing slashes and defaults the timeout", () => {
    expect(loadConfig({ HEXPROCURE_URL: "https://hex.example.com//", HEXPROCURE_TOKEN: "hxp_x" })).toEqual({
      baseUrl: "https://hex.example.com",
      token: "hxp_x",
      timeoutMs: 10_000,
    });
    expect(loadConfig({ HEXPROCURE_URL: "http://localhost:3000", HEXPROCURE_TOKEN: "hxp_x", HEXPROCURE_TIMEOUT_MS: "2500" }).timeoutMs).toBe(2500);
  });

  it("names every missing variable and never echoes the token", () => {
    expect(() => loadConfig({})).toThrow(/HEXPROCURE_URL, HEXPROCURE_TOKEN/);
    expect(() => loadConfig({ HEXPROCURE_URL: "https://h.test" })).toThrow(/HEXPROCURE_TOKEN/);
    expect(() => loadConfig({ HEXPROCURE_TOKEN: "hxp_secret" })).not.toThrow(/hxp_secret/);
  });

  it("rejects a bad url, scheme or timeout", () => {
    const base = { HEXPROCURE_TOKEN: "hxp_x" };
    expect(() => loadConfig({ ...base, HEXPROCURE_URL: "nope" })).toThrow(/valid URL/);
    expect(() => loadConfig({ ...base, HEXPROCURE_URL: "ftp://h.test" })).toThrow(/http/);
    expect(() => loadConfig({ ...base, HEXPROCURE_URL: "https://h.test", HEXPROCURE_TIMEOUT_MS: "0" })).toThrow(/TIMEOUT/);
    expect(() => loadConfig({ ...base, HEXPROCURE_URL: "https://h.test", HEXPROCURE_TIMEOUT_MS: "abc" })).toThrow(/TIMEOUT/);
  });
});
