import { NextResponse } from "next/server";
import { login } from "@/lib/services/auth";
import { sessionSetCookieHeader } from "@/lib/auth";
import { errorToResponse, readJson } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const token = await login(body.email, body.password);
    const res = NextResponse.json({ ok: true });
    res.headers.set("set-cookie", sessionSetCookieHeader(token));
    return res;
  } catch (error) {
    return errorToResponse(error);
  }
}
