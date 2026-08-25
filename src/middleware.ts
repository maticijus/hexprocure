import { NextResponse, type NextRequest } from "next/server";
import {
  checkCsrfOrigin,
  checkRateLimit,
  limitsPerMinute,
} from "@/lib/api/request-guards";

const PUBLIC_PATHS = ["/login", "/api/v1/auth/login", "/api/v1/auth/register", "/api/health"];
const PUBLIC_API_PATHS = ["/api/v1/auth/login", "/api/v1/auth/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // security guards apply before anything else
  if (pathname.startsWith("/api/")) {
    const hasBearer = (request.headers.get("authorization") ?? "").startsWith("Bearer hxp_");
    const csrf = checkCsrfOrigin(request, { hasBearer });
    if (csrf) return csrf;
    const isAuth = PUBLIC_API_PATHS.some((p) => pathname.startsWith(p));
    const limits = limitsPerMinute();
    const limit = isAuth ? limits.auth : limits.mutation;
    const limited = checkRateLimit(request, limit, 60_000);
    if (limited) return limited;
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (!request.cookies.get("hexprocure_session")?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Authentication required" } },
        { status: 403 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
