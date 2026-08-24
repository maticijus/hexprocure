"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    await fetch(`/api/v1/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex gap-2">
      <button
        disabled={busy}
        onClick={() => decide("approve")}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        disabled={busy}
        onClick={() => decide("reject")}
        className="rounded-lg bg-white border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
