import { DomainError } from "@/lib/services/p2p/shared";
import { getCostCenter } from "./cost-centers";
import { getSupplier } from "./suppliers";

/** New requisitions may only reference active suppliers and cost centers. */
export async function assertPickable(supplierId: string, costCenterId: string): Promise<void> {
  const [supplier, costCenter] = await Promise.all([
    getSupplier(supplierId).catch(() => null),
    getCostCenter(costCenterId).catch(() => null),
  ]);
  const errors: string[] = [];
  if (!supplier || supplier.archivedAt) errors.push("supplierId must be an active supplier");
  if (!costCenter || costCenter.archivedAt) errors.push("costCenterId must be an active cost center");
  if (errors.length > 0) throw new DomainError("VALIDATION", errors.join("; "));
}
