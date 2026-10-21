import { NextResponse } from "next/server";

/** Guards for mutating API requests. Non-browser machine clients authenticate
 *  with Bearer API tokens and are exempt from the origin check (tokens cannot
 *  be sent cross-origin by a victim's browser, so CSRF does not apply). */

/** Client-controlled headers (X-Forwarded-For, X-Real-IP) are only honoured
 *  behind a proxy the operator vouches for (TRUST_PROXY=true); that proxy
 *  appends the real peer last. Otherwise every client shares one bucket. */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY !== "true") return "direct";
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",");
  const last = hops[hops.length - 1].trim();
  return last || request.headers.get("x-real-ip")?.trim() || "direct";
}

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const host = request.headers.get("host");
  if (host) {
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  }
  for (const extra of (process.env.ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

/** Returns a 403 response when a mutating browser request fails the origin
 *  check; null when allowed. Bearer-authenticated requests bypass this —
 *  they are not cookie-borne and therefore not CSRF-able. */
export function checkCsrfOrigin(
  request: Request,
  opts: { hasBearer?: boolean } = {},
): Response | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (opts.hasBearer) return null;

  const origin = request.headers.get("origin");
  // Browsers always attach Origin to cross-site POSTs; same-origin fetch/XHR
  // attach it too in all modern engines. Missing Origin ⇒ non-browser client
  // without a token ⇒ reject.
  if (!origin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Missing Origin header" } },
      { status: 403 },
    );
  }

  if (!allowedOrigins(request).has(origin)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } },
      { status: 403 },
    );
  }
  return null;
}

interface WindowState {
  hits: number[];
  windowMs: number;
}

const windows = new Map<string, WindowState>();
/** Shared by every key that arrives while the map is full of live counters. */
let overflow: WindowState | null = null;
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 1000;
const MAX_TRACKED_KEYS = 10_000;

export function resetRateLimits(): void {
  windows.clear();
  overflow = null;
  lastSweep = 0;
}

/** Spec classes (auth 10 · mutations 60 · reads 300 per minute) with env
 *  overrides so load tests and E2E can raise them without code changes. */
export function limitsPerMinute(): { auth: number; mutation: number; read: number } {
  const positive = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    auth: positive(process.env.RATE_LIMIT_AUTH_PER_MIN, 10),
    mutation: positive(process.env.RATE_LIMIT_MUTATION_PER_MIN, 60),
    read: positive(process.env.RATE_LIMIT_READ_PER_MIN, 300),
  };
}

export function rateLimitKeyCount(): number {
  return windows.size;
}

/** Drops entries whose window has fully elapsed. Live counters are never
 *  evicted, so flooding fresh keys cannot reset a real offender. */
function evictExpiredKeys(now: number): void {
  // Throttled: a full-map flood must not trigger an O(n) scan per request.
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, state] of windows) {
    if (state.hits.every((h) => now - h >= state.windowMs)) windows.delete(k);
  }
}

function stateFor(key: string, windowMs: number, now: number): WindowState {
  const existing = windows.get(key);
  if (existing) return existing;
  if (windows.size >= MAX_TRACKED_KEYS) evictExpiredKeys(now);
  if (windows.size >= MAX_TRACKED_KEYS) return (overflow ??= { hits: [], windowMs });
  const created: WindowState = { hits: [], windowMs };
  windows.set(key, created);
  return created;
}

function limitedResponse(state: WindowState, limit: number, now: number): Response | null {
  state.hits = state.hits.filter((h) => now - h < state.windowMs);
  if (state.hits.length < limit) return null;
  const oldest = Math.min(...state.hits);
  const retryAfterSec = Math.max(1, Math.ceil((oldest + state.windowMs - now) / 1000));
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } },
  );
}

function consume(key: string, limit: number, windowMs: number): Response | null {
  const now = Date.now();
  const state = stateFor(key, windowMs, now);
  const limited = limitedResponse(state, limit, now);
  if (!limited) state.hits.push(now);
  return limited;
}

export function checkRateLimit(
  request: Request,
  limit: number,
  windowMs: number,
): Response | null {
  const path = new URL(request.url).pathname.split("/").slice(0, 4).join("/");
  return consume(`${getClientIp(request)}:${path}`, limit, windowMs);
}

/** Per-account limit keyed on email plus client bucket, so one client cannot
 *  exhaust a victim's budget for everyone else. Only failed attempts count
 *  (recordLoginFailure) and a success clears the counter (clearLoginFailures). */
function loginKey(request: Request, email: string): string {
  return `login:${getClientIp(request)}:${email.trim().toLowerCase().slice(0, 254)}`;
}

export function checkLoginRateLimit(
  request: Request,
  email: string,
  limit: number,
): Response | null {
  const key = loginKey(request, email);
  const state = windows.get(key) ?? (windows.size >= MAX_TRACKED_KEYS ? overflow : null);
  return state ? limitedResponse(state, limit, Date.now()) : null;
}

export function recordLoginFailure(request: Request, email: string, windowMs: number): void {
  const now = Date.now();
  stateFor(loginKey(request, email), windowMs, now).hits.push(now);
}

export function clearLoginFailures(request: Request, email: string): void {
  windows.delete(loginKey(request, email));
}
