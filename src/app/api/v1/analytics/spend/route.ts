import { NextResponse } from "next/server";
import { spendByGroup, type AnalyticsGroupBy } from "@/lib/services/analytics";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

const GROUPS = new Set(["supplier", "costCenter", "month"]);

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "FINANCE" && actor.role !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "Requires FINANCE or ADMIN role");
    }
    const url = new URL(request.url);
    const groupBy = url.searchParams.get("groupBy") ?? "supplier";
    if (!GROUPS.has(groupBy)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "groupBy must be supplier, costCenter, or month" } },
        { status: 400 },
      );
    }
    const rows = await spendByGroup({
      groupBy: groupBy as AnalyticsGroupBy,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return NextResponse.json({ rows });
  } catch (error) {
    return errorToResponse(error);
  }
}
