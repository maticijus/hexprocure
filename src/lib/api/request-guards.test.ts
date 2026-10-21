import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkCsrfOrigin,
  checkRateLimit,
  limitsPerMinute,
  rateLimitKeyCount,
  resetRateLimits,
} from "./request-guards";

const req = (opts: {
  method?: string;
  origin?: string | null;
  host?: string;
  ip?: string;
  xff?: string;
}) => {
  const headers = new Headers({ host: opts.host ?? "procure.example.com" });
  if (opts.origin !== undefined && opts.origin !== null) headers.set("origin", opts.origin);
  if (opts.ip) headers.set("x-real-ip", opts.ip);
  if (opts.xff) headers.set("x-forwarded-for", opts.xff);
  return new Request("https://procure.example.com/api/v1/x", {
    method: opts.method ?? "POST",
    headers,
  });
};

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("CSRF origin check (mutations only)", () => {
  it("allows GET regardless of origin", () => {
    expect(checkCsrfOrigin(req({ method: "GET", origin: "https://evil.com" }))).toBeNull();
  });

  it("allows same-origin POST", () => {
    expect(checkCsrfOrigin(req({ method: "POST", origin: "https://procure.example.com" }))).toBeNull();
  });

  it("rejects cross-origin POST with 403 payload", () => {
    const res = checkCsrfOrigin(req({ method: "POST", origin: "https://evil.com" }));
    expect(res?.status).toBe(403);
  });

  it("rejects POST with no Origin header (browser always sends one)", () => {
    // but Bearer-token machine clients have an exemption
    const res = checkCsrfOrigin(req({ method: "POST", origin: null }), { hasBearer: true });
    expect(res).toBeNull();
    const rejected = checkCsrfOrigin(req({ method: "POST", origin: null }));
    expect(rejected?.status).toBe(403);
  });

  it("allows localhost dev origins when configured", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000";
    const r = req({ method: "POST", host: "localhost:3000", origin: "http://localhost:3000" });
    expect(checkCsrfOrigin(r)).toBeNull();
    delete process.env.ALLOWED_ORIGINS;
  });

  it("Bearer-token machine requests bypass the origin check entirely", () => {
    const res = checkCsrfOrigin(req({ method: "POST", origin: null }), { hasBearer: true });
    expect(res).toBeNull();
  });
});

describe("rate limiting", () => {
  beforeEach(() => vi.stubEnv("TRUST_PROXY", "true"));

  it("passes under the limit and returns 429 after burst", () => {
    let last = null;
    for (let i = 0; i < 10; i++) last = checkRateLimit(req({ ip: "9.9.9.9" }), 10, 60_000);
    expect(last).toBeNull();

    last = checkRateLimit(req({ ip: "9.9.9.9" }), 10, 60_000);
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 10; i++) checkRateLimit(req({ ip: "8.8.8.8" }), 10, 60_000);
    expect(checkRateLimit(req({ ip: "7.7.7.7" }), 10, 60_000)).toBeNull();
  });

  it("windows expire so clients recover", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) checkRateLimit(req({ ip: "6.6.6.6" }), 5, 1000);
      expect(checkRateLimit(req({ ip: "6.6.6.6" }), 5, 1000)?.status).toBe(429);
      vi.advanceTimersByTime(2000);
      expect(checkRateLimit(req({ ip: "6.6.6.6" }), 5, 1000)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rate limit client key", () => {
  it("ignores spoofed X-Forwarded-For when TRUST_PROXY is unset", () => {
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = checkRateLimit(req({ xff: `10.0.0.${i}` }), 10, 60_000);
    expect(last?.status).toBe(429);
  });

  it("keys on the right-most X-Forwarded-For hop when TRUST_PROXY=true", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = checkRateLimit(req({ xff: `1.2.3.${i}, 203.0.113.9` }), 10, 60_000);
    }
    expect(last?.status).toBe(429);
    expect(checkRateLimit(req({ xff: "1.2.3.4, 203.0.113.10" }), 10, 60_000)).toBeNull();
  });

  it("ignores X-Real-IP and shares one bucket when TRUST_PROXY is unset", () => {
    for (let i = 0; i < 10; i++) checkRateLimit(req({ ip: `5.5.5.${i}` }), 10, 60_000);
    expect(checkRateLimit(req({ ip: "5.5.5.99" }), 10, 60_000)?.status).toBe(429);
  });

  it("falls back to X-Real-IP when TRUST_PROXY=true and no forwarded hop", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    for (let i = 0; i < 10; i++) checkRateLimit(req({ ip: "5.5.5.5" }), 10, 60_000);
    expect(checkRateLimit(req({ ip: "5.5.5.5" }), 10, 60_000)?.status).toBe(429);
    expect(checkRateLimit(req({ ip: "5.5.5.6" }), 10, 60_000)).toBeNull();
  });

  it("caps tracked keys and evicts the oldest", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    for (let i = 0; i < 10_050; i++) checkRateLimit(req({ ip: `ip-${i}` }), 10, 60_000);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(10_000);
    // oldest key was evicted, so it starts a fresh window
    for (let i = 0; i < 9; i++) checkRateLimit(req({ ip: "ip-0" }), 10, 60_000);
    expect(checkRateLimit(req({ ip: "ip-0" }), 10, 60_000)).toBeNull();
  });
});

describe("limitsPerMinute", () => {
  it("defaults to the spec classes: auth 10, mutations 60, reads 300", () => {
    delete process.env.RATE_LIMIT_AUTH_PER_MIN;
    delete process.env.RATE_LIMIT_MUTATION_PER_MIN;
    delete process.env.RATE_LIMIT_READ_PER_MIN;
    expect(limitsPerMinute()).toEqual({ auth: 10, mutation: 60, read: 300 });
  });

  it("honours env overrides (E2E/load-test escape hatch)", () => {
    process.env.RATE_LIMIT_AUTH_PER_MIN = "1000";
    process.env.RATE_LIMIT_MUTATION_PER_MIN = "9999";
    process.env.RATE_LIMIT_READ_PER_MIN = "0";
    expect(limitsPerMinute()).toEqual({ auth: 1000, mutation: 9999, read: 300 });
    delete process.env.RATE_LIMIT_AUTH_PER_MIN;
    delete process.env.RATE_LIMIT_MUTATION_PER_MIN;
    delete process.env.RATE_LIMIT_READ_PER_MIN;
  });
});
