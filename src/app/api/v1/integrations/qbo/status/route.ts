import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationsConnections } from "@/lib/db/schema";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    await getActor(request);
    const [row] = await db
      .select()
      .from(integrationsConnections)
      .where(eq(integrationsConnections.provider, "qbo"))
      .orderBy(desc(integrationsConnections.createdAt))
      .limit(1);
    return NextResponse.json({
      connected: !!row && row.status === "ACTIVE",
      status: row?.status ?? "NEVER_CONNECTED",
      realmId: row?.realmId ?? null,
      refreshExpiresAt: row?.refreshExpiresAt ?? null,
      lastError: row?.lastError ?? null,
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
