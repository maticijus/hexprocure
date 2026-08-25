import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try {
    await db.execute(sql`SELECT 1`);
    database = true;
  } catch {
    database = false;
  }
  return NextResponse.json({ status: "ok", database }, { status: database ? 200 : 503 });
}
