import { NextResponse } from "next/server";
import { verifyOAuthState, clearStateCookie } from "@/lib/integrations/oauth-state";
import { upsertQboConnection } from "@/lib/integrations/qbo-connection";
import { errorToResponse } from "@/lib/api/helpers";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const state = url.searchParams.get("state");
    const secret = process.env.AUTH_SECRET!;

    if (!code || !realmId || !verifyOAuthState(state, request.headers.get("cookie"), secret)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "Invalid or expired OAuth state" } },
        { status: 400 },
      );
    }

    if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
      return NextResponse.json(
        { error: { code: "NOT_CONFIGURED", message: "QBO client credentials missing" } },
        { status: 501 },
      );
    }

    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.INTEGRATION_REDIRECT_URI ?? "",
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_STATE", message: `Token exchange failed: HTTP ${res.status}` } },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await upsertQboConnection({
      realmId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessExpiresIn: data.expires_in,
    });

    const res2 = NextResponse.json({ ok: true });
    res2.headers.set("set-cookie", clearStateCookie());
    return res2;
  } catch (error) {
    return errorToResponse(error);
  }
}
