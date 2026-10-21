import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { resetRateLimits } from "@/lib/api/request-guards";

const call = (method: string, path: string, ip = "1.1.1.1") =>
  middleware(
    new NextRequest(`https://procure.example.com${path}`, {
      method,
      headers: {
        host: "procure.example.com",
        origin: "https://procure.example.com",
        "x-real-ip": ip,
        cookie: "hexprocure_session=abc",
      },
    }),
  );

const burst = (method: string, path: string, n: number, ip?: string) => {
  let last = call(method, path, ip);
  for (let i = 1; i < n; i++) last = call(method, path, ip);
  return last;
};

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("middleware API rate limits", () => {
  it("lets GET requests exceed the mutation limit up to the read limit", () => {
    expect(burst("GET", "/api/v1/requisitions", 61).status).not.toBe(429);
    expect(burst("HEAD", "/api/v1/suppliers", 61).status).not.toBe(429);
  });

  it("returns 429 for GET past the read limit", () => {
    vi.stubEnv("RATE_LIMIT_READ_PER_MIN", "100");
    expect(burst("GET", "/api/v1/requisitions", 100).status).not.toBe(429);
    expect(call("GET", "/api/v1/requisitions").status).toBe(429);
  });

  it("returns 429 for POST past the mutation limit", () => {
    expect(burst("POST", "/api/v1/requisitions", 60).status).not.toBe(429);
    expect(call("POST", "/api/v1/requisitions").status).toBe(429);
  });

  it("keeps login on the auth limit even for GET", () => {
    expect(burst("POST", "/api/v1/auth/login", 10).status).not.toBe(429);
    expect(call("POST", "/api/v1/auth/login").status).toBe(429);
    expect(burst("GET", "/api/v1/auth/register", 10, "2.2.2.2").status).not.toBe(429);
    expect(call("GET", "/api/v1/auth/register", "2.2.2.2").status).toBe(429);
  });
});
