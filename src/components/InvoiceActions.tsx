"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorNote } from "@/components/ui";
import { postJson } from "@/lib/client-api";

const BUTTON = "rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50";

export function InvoiceActions({ invoiceId, canMatch, canApprove }: { invoiceId: string; canMatch: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "match" | "approve") {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/v1/invoices/${invoiceId}/${action}`);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {canMatch && <button onClick={() => run("match")} disabled={busy} className={BUTTON}>Match</button>}
      {canApprove && <button onClick={() => run("approve")} disabled={busy} className={BUTTON}>Approve invoice</button>}
      <ErrorNote message={error} />
    </div>
  );
}
