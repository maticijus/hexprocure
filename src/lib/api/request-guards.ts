import { isIP } from "node:net";
import { NextResponse } from "next/server";

/** Guards for mutating API requests. Non-browser machine clients authenticate
 *  with Bearer API tokens and are exempt from the origin check (tokens cannot
 *  be sent cross-origin by a victim's browser, so CSRF does not apply). */

const MAX_IP_LENGTH = 45;

/** Only a syntactically valid IPv4 or IPv6 literal may become a key component. */
function ipLiteral(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value || value.length > MAX_IP_LENGTH || isIP(value) === 0) return null;
  return value.toLowerCase();
}

/** Client-controlled headers (X-Forwarded-For, X-Real-IP) are only honoured
 *  behind a proxy the operator vouches for (TRUST_PROXY=true); that proxy
 *  appends the real peer last. Otherwise, or when the value is not a valid IP
 *  literal, every client shares one bucket. */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY !== "true") return "direct";
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",");
  const last = hops[hops.length - 1].trim();
  return ipLiteral(last || request.headers.get("x-real-ip")) ?? "direct";
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

/** One store per guard, so traffic that fills one guard cannot starve another.
 *  Live keys are grouped by client bucket: a client owns at most
 *  MAX_KEYS_PER_CLIENT of them, and its extra keys share one overflow bucket
 *  keyed by that client, so a flooding client only throttles itself. */
interface Store {
  clients: Map<string, Map<string, WindowState>>;
  keys: number;
  overflow: Map<string, WindowState>;
  /** Last resort when even the per-client overflow map is full. */
  lastResort: WindowState | null;
  lastSweep: number;
}

export type Guard = "api" | "auth" | "email";

const newStore = (): Store => ({
  clients: new Map(),
  keys: 0,
  overflow: new Map(),
  lastResort: null,
  lastSweep: 0,
});

const stores: Record<Guard, Store> = { api: newStore(), auth: newStore(), email: newStore() };
const SWEEP_INTERVAL_MS = 1000;
const MAX_TRACKED_KEYS = 10_000;
const MAX_KEYS_PER_CLIENT = 64;

export function resetRateLimits(): void {
  stores.api = newStore();
  stores.auth = newStore();
  stores.email = newStore();
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
  return stores.api.keys + stores.auth.keys + stores.email.keys;
}

const isExpired = (state: WindowState, now: number) =>
  state.hits.every((h) => now - h >= state.windowMs);

function dropClientKey(store: Store, client: string, mine: Map<string, WindowState>, rest: string) {
  mine.delete(rest);
  store.keys--;
  if (mine.size === 0) store.clients.delete(client);
}

/** Drops one client's expired keys. Live counters are never evicted. */
function evictExpiredForClient(store: Store, client: string, now: number): void {
  const mine = store.clients.get(client);
  if (!mine) return;
  for (const [rest, state] of [...mine]) {
    if (isExpired(state, now)) dropClientKey(store, client, mine, rest);
  }
}

/** Drops every expired key. Throttled: a full-map flood must not trigger an
 *  O(n) scan per request. */
function evictExpiredKeys(store: Store, now: number): void {
  if (now - store.lastSweep < SWEEP_INTERVAL_MS) return;
  store.lastSweep = now;
  for (const client of [...store.clients.keys()]) evictExpiredForClient(store, client, now);
  for (const [client, state] of store.overflow) {
    if (isExpired(state, now)) store.overflow.delete(client);
  }
}

function overflowFor(store: Store, client: string, windowMs: number, now: number): WindowState {
  const existing = store.overflow.get(client);
  if (existing) return existing;
  if (store.overflow.size >= MAX_TRACKED_KEYS) evictExpiredKeys(store, now);
  if (store.overflow.size >= MAX_TRACKED_KEYS) return (store.lastResort ??= { hits: [], windowMs });
  const created: WindowState = { hits: [], windowMs };
  store.overflow.set(client, created);
  return created;
}

function stateFor(
  store: Store,
  client: string,
  rest: string,
  windowMs: number,
  now: number,
): WindowState {
  const existing = store.clients.get(client)?.get(rest);
  if (existing) return existing;
  if ((store.clients.get(client)?.size ?? 0) >= MAX_KEYS_PER_CLIENT) {
    evictExpiredForClient(store, client, now);
  }
  if (store.keys >= MAX_TRACKED_KEYS) evictExpiredKeys(store, now);
  const mine = store.clients.get(client);
  if ((mine?.size ?? 0) >= MAX_KEYS_PER_CLIENT || store.keys >= MAX_TRACKED_KEYS) {
    return overflowFor(store, client, windowMs, now);
  }
  const created: WindowState = { hits: [], windowMs };
  if (mine) mine.set(rest, created);
  else store.clients.set(client, new Map([[rest, created]]));
  store.keys++;
  return created;
}

/** Read-only lookup: the key's own counter, else the client's overflow bucket. */
function peekState(store: Store, client: string, rest: string): WindowState | null {
  return (
    store.clients.get(client)?.get(rest) ?? store.overflow.get(client) ?? store.lastResort
  );
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

export function checkRateLimit(
  request: Request,
  limit: number,
  windowMs: number,
  guard: "api" | "auth" = "api",
): Response | null {
  const path = new URL(request.url).pathname.split("/").slice(0, 4).join("/");
  const now = Date.now();
  const state = stateFor(stores[guard], getClientIp(request), path, windowMs, now);
  const limited = limitedResponse(state, limit, now);
  if (!limited) state.hits.push(now);
  return limited;
}

/** Per-account limit keyed on email plus client bucket, so one client cannot
 *  exhaust a victim's budget for everyone else. Only failed attempts count
 *  (recordLoginFailure) and a success clears the counter (clearLoginFailures). */
const loginEmail = (email: string): string => email.trim().toLowerCase().slice(0, 254);

export function checkLoginRateLimit(
  request: Request,
  email: string,
  limit: number,
): Response | null {
  const state = peekState(stores.email, getClientIp(request), loginEmail(email));
  return state ? limitedResponse(state, limit, Date.now()) : null;
}

export function recordLoginFailure(request: Request, email: string, windowMs: number): void {
  const now = Date.now();
  stateFor(stores.email, getClientIp(request), loginEmail(email), windowMs, now).hits.push(now);
}

/** Clears only the exact email plus client pair. */
export function clearLoginFailures(request: Request, email: string): void {
  const store = stores.email;
  const client = getClientIp(request);
  const mine = store.clients.get(client);
  if (mine?.has(loginEmail(email))) dropClientKey(store, client, mine, loginEmail(email));
}
