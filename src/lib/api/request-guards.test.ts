import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkCsrfOrigin,
  checkRateLimit,
  resetRateLimits,
} from "./request-guards";

const req = (opts: { method?: string; origin?: string | null; host?: string; ip?: string }) => {
  const headers = new Headers({ host: opts.host ?? "procure.example.com" });
  if (opts.origin !== undefined && opts.origin !== null) headers.set("origin", opts.origin);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  return new Request("https://procure.example.com/api/v1/x", {
    method: opts.method ?? "POST",
    headers,
  });
};

beforeEach(() => resetRateLimits());

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
