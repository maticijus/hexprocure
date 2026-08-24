import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
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

export async function getActor(request: Request) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    throw new DomainError("FORBIDDEN", "Missing x-user-id");
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
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
