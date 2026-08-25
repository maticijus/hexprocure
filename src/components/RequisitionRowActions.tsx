"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RequisitionRowActions({
  requisitionId,
  status,
}: {
  requisitionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/requisitions/${requisitionId}/submit`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Submit failed");
    }
    setBusy(false);
    router.refresh();
  }

  if (status !== "DRAFT") return error ? <span className="text-xs text-red-600">{error}</span> : null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
