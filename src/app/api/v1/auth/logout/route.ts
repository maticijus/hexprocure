import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("set-cookie", "hexprocure_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
  return res;
}
