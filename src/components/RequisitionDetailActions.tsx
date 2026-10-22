"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ErrorNote } from "@/components/ui";
import { postJson } from "@/lib/client-api";

interface Props {
  requisitionId: string;
  canSubmit: boolean;
  pendingApprovalId: string | null;
  canOrder: boolean;
  poId: string | null;
}

const PRIMARY = "rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50";

export function RequisitionDetailActions({ requisitionId, canSubmit, pendingApprovalId, canOrder, poId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, onDone: (body: { purchaseOrderId?: string }) => void) {
    setBusy(true);
    setError(null);
    const result = await postJson<{ purchaseOrderId?: string }>(path);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result.body);
  }

  const submit = () => run(`/api/v1/requisitions/${requisitionId}/submit`, () => router.refresh());
  const order = () =>
    run(`/api/v1/requisitions/${requisitionId}/order`, (b) => router.push(`/purchase-orders/${b.purchaseOrderId}`));

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canSubmit && <button onClick={submit} disabled={busy} className={PRIMARY}>Submit</button>}
      {pendingApprovalId && <ApprovalActions approvalId={pendingApprovalId} />}
      {canOrder && !poId && <button onClick={order} disabled={busy} className={PRIMARY}>Create purchase order</button>}
      {poId && <Link href={`/purchase-orders/${poId}`} className="text-sm text-[var(--brand)] hover:underline">View purchase order</Link>}
      <ErrorNote message={error} />
    </div>
  );
}
