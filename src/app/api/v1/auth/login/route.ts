import { NextResponse } from "next/server";
import { login } from "@/lib/services/auth";
import { sessionSetCookieHeader } from "@/lib/auth";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  limitsPerMinute,
  recordLoginFailure,
} from "@/lib/api/request-guards";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, readJson } from "@/lib/api/helpers";

const LOGIN_WINDOW_MS = 60_000;

/** Only rejected credentials count toward the per-email limit; success resets it. */
async function loginCountingFailures(
  request: Request,
  email: string | null,
  password: string | undefined,
): Promise<string> {
  try {
    const token = await login(email ?? undefined, password);
    if (email) clearLoginFailures(request, email);
    return token;
  } catch (error) {
    if (email && error instanceof DomainError && error.code === "FORBIDDEN") {
      recordLoginFailure(request, email, LOGIN_WINDOW_MS);
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = typeof body.email === "string" ? body.email : null;
    if (email) {
      const limited = checkLoginRateLimit(request, email, limitsPerMinute().auth, LOGIN_WINDOW_MS);
      if (limited) return limited;
    }
    const token = await loginCountingFailures(request, email, body.password);
    const res = NextResponse.json({ ok: true });
    res.headers.set("set-cookie", sessionSetCookieHeader(token));
    return res;
  } catch (error) {
    return errorToResponse(error);
  }
}
