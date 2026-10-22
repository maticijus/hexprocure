import { NextResponse } from "next/server";
import { listCostCenters } from "@/lib/services/master-data/cost-centers";
import { listSuppliers } from "@/lib/services/master-data/suppliers";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    await getActor(request);
    const [supplierRows, ccRows] = await Promise.all([
      listSuppliers(),
      listCostCenters(),
    ]);
    return NextResponse.json({
      suppliers: supplierRows.map((s) => ({ id: s.id, name: s.name })),
      costCenters: ccRows.map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
