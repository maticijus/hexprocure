import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { DomainError } from "@/lib/services/p2p";

const STATUS_BY_CODE: Record<DomainError["code"], number> = {
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  BUDGET_EXCEEDED: 422,
  FORBIDDEN: 403,
};

export function errorToResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: STATUS_BY_CODE[error.code] },
    );
  }
  console.error("Unhandled API error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 },
  );
}

export function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error("AUTH_SECRET must be set (min 8 chars)");
  }
  return secret;
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export async function getActor(request: Request) {
  const token = readSessionCookie(request);
  if (!token) {
    throw new DomainError("FORBIDDEN", "Authentication required");
  }
  const payload = verifySessionToken(token, requireAuthSecret());
  if (!payload) {
    throw new DomainError("FORBIDDEN", "Invalid or expired session");
  }
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId));
  if (!user) {
    throw new DomainError("NOT_FOUND", "Unknown user");
  }
  return user;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new DomainError("INVALID_STATE", "Invalid JSON body");
  }
}
