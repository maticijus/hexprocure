import { NextResponse } from "next/server";
import { errorToResponse, readSessionCookie } from "@/lib/api/helpers";
import { revokeSession } from "@/lib/services/sessions";

export async function POST(request: Request) {
  try {
    const token = readSessionCookie(request);
    if (token) await revokeSession(token);
    const res = NextResponse.json({ ok: true });
    res.headers.set("set-cookie", "hexprocure_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
    return res;
  } catch (error) {
    return errorToResponse(error);
  }
}
