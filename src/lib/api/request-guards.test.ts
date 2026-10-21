import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkCsrfOrigin,
  checkLoginRateLimit,
  checkRateLimit,
  limitsPerMinute,
  rateLimitKeyCount,
  recordLoginFailure,
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

  describe("bounded key map", () => {
    const hit = (ip: string, limit = 10) => checkRateLimit(req({ ip }), limit, 60_000);
    const fill = (n: number) => {
      for (let i = 0; i < n; i++) hit(`fill-${i}`);
    };

    beforeEach(() => vi.stubEnv("TRUST_PROXY", "true"));

    it("never tracks more than the cap", () => {
      fill(10_050);
      expect(rateLimitKeyCount()).toBeLessThanOrEqual(10_000);
    });

    it("keeps a live offender's counter when fresh keys flood a full map", () => {
      for (let i = 0; i < 10; i++) hit("offender");
      fill(10_000);
      for (let i = 0; i < 200; i++) hit(`flood-${i}`);
      expect(hit("offender")?.status).toBe(429);
    });

    it("limits a new client through its own overflow bucket once full", () => {
      fill(10_000);
      let last: Response | null = null;
      for (let i = 0; i < 11; i++) last = hit("newcomer");
      expect(last?.status).toBe(429);
      expect(hit("another-newcomer")).toBeNull();
    });

    it("evicts expired entries first, so fresh keys get their own bucket", () => {
      vi.useFakeTimers();
      try {
        fill(10_000);
        vi.advanceTimersByTime(61_000);
        expect(hit("late-a", 1)).toBeNull();
        expect(hit("late-b", 1)).toBeNull();
        expect(rateLimitKeyCount()).toBeLessThanOrEqual(10_000);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("per-client key cap", () => {
  const MAX_PER_CLIENT = 64;
  const at = (ip: string, path: string) =>
    new Request(`https://procure.example.com/api/v1/${path}/x`, {
      method: "POST",
      headers: { host: "procure.example.com", "x-real-ip": ip },
    });
  const flood = (ip: string, n: number) => {
    const results: (Response | null)[] = [];
    for (let i = 0; i < n; i++) results.push(checkRateLimit(at(ip, `p${i}`), 10, 60_000));
    return results;
  };

  beforeEach(() => vi.stubEnv("TRUST_PROXY", "true"));

  it("never lets one client own more than the cap of live keys", () => {
    flood("20.0.0.1", 1000);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(MAX_PER_CLIENT);
  });

  it("throttles the flooding client itself through its own overflow bucket", () => {
    const results = flood("20.0.0.2", 200);
    expect(results[results.length - 1]?.status).toBe(429);
  });

  it("10,000 distinct paths from one client leave another client's first request alone", () => {
    flood("20.0.0.3", 10_100);
    expect(checkRateLimit(at("20.0.0.4", "login"), 10, 60_000)).toBeNull();
  });

  it("per-email failures from a flooding client do not limit another client", () => {
    const post = (ip: string) =>
      new Request("https://procure.example.com/api/v1/auth/login", {
        method: "POST",
        headers: { "x-real-ip": ip },
      });
    for (let i = 0; i < 10_100; i++) recordLoginFailure(post("20.0.0.5"), `e${i}@hex.test`, 60_000);
    expect(checkLoginRateLimit(post("20.0.0.6"), "victim@hex.test", 10)).toBeNull();
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

describe("guard isolation", () => {
  it("api-guard flooding does not touch the auth guard of the same client", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const at = (path: string) =>
      new Request(`https://procure.example.com/api/v1/${path}/x`, {
        method: "POST",
        headers: { "x-real-ip": "21.0.0.1" },
      });
    for (let i = 0; i < 500; i++) checkRateLimit(at(`p${i}`), 10, 60_000);
    expect(checkRateLimit(at("auth"), 10, 60_000, "auth")).toBeNull();
  });
});
