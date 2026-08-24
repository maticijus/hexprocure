import { NextResponse } from "next/server";

/** Guards for mutating API requests. Non-browser machine clients authenticate
 *  with Bearer API tokens and are exempt from the origin check (tokens cannot
 *  be sent cross-origin by a victim's browser, so CSRF does not apply). */

export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
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
}

const windows = new Map<string, WindowState>();
const MAX_TRACKED_KEYS = 10_000;

export function resetRateLimits(): void {
  windows.clear();
}

export function checkRateLimit(
  request: Request,
  limit: number,
  windowMs: number,
): Response | null {
  const key = `${getClientIp(request)}:${new URL(request.url).pathname.split("/").slice(0, 4).join("/")}`;
  const now = Date.now();

  if (!windows.has(key) && windows.size >= MAX_TRACKED_KEYS) {
    // bounded memory: drop expired windows before refusing new tracking
    for (const [k, state] of windows) {
      if (state.hits.every((h) => now - h > windowMs)) windows.delete(k);
      if (windows.size < MAX_TRACKED_KEYS) break;
    }
  }

  const state = windows.get(key) ?? { hits: [] };
  state.hits = state.hits.filter((h) => now - h < windowMs);
  if (state.hits.length >= limit) {
    const oldest = Math.min(...state.hits);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    windows.set(key, state);
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      { status: 429, headers: { "retry-after": String(retryAfterSec) } },
    );
  }
  state.hits.push(now);
  windows.set(key, state);
  return null;
}
