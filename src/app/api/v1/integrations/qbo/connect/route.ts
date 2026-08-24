import { NextResponse } from "next/server";
import { createOAuthState } from "@/lib/integrations/oauth-state";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Requires ADMIN role");

    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = process.env.INTEGRATION_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: { code: "NOT_CONFIGURED", message: "Set QBO_CLIENT_ID and INTEGRATION_REDIRECT_URI" } },
        { status: 501 },
      );
    }
    const secret = process.env.AUTH_SECRET!;
    const { state, cookie } = createOAuthState(secret);
    const url = new URL("https://appcenter.intuit.com/connect/oauth2");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    const res = NextResponse.redirect(url.toString());
    res.headers.set("set-cookie", cookie);
    return res;
  } catch (error) {
    return errorToResponse(error);
  }
}

