import { NextResponse } from "next/server";
import { login } from "@/lib/services/auth";
import { sessionSetCookieHeader } from "@/lib/auth";
import { checkLoginRateLimit, limitsPerMinute } from "@/lib/api/request-guards";
import { errorToResponse, readJson } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    if (typeof body.email === "string") {
      const limited = checkLoginRateLimit(body.email, limitsPerMinute().auth, 60_000);
      if (limited) return limited;
    }
    const token = await login(body.email, body.password, request.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true });
    res.headers.set("set-cookie", sessionSetCookieHeader(token));
    return res;
  } catch (error) {
    return errorToResponse(error);
  }
}
