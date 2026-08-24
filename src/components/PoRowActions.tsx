"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PoRowActions({
  poId,
  status,
  hasServices,
  canSend,
}: {
  poId: string;
  status: string;
  hasServices: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);


  async function send() {
    if (!confirm("Email this purchase order PDF to the supplier?")) return;
    setBusy("send");
    const res = await fetch(`/api/v1/purchase-orders/${poId}/send`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Sent ✓" : data?.error?.message ?? "Send failed");
    setBusy(null);
    router.refresh();
  }

  async function acceptServices() {
    if (!confirm("Accept all service work on this PO? This records your acceptance in the audit trail.")) return;
    setBusy("accept");
    try {
      const data = await fetch(`/api/v1/purchase-orders/${poId}/lines`)
        .then((r) => r.json());
      const serviceLines = (data.lines ?? []).filter(
        (l: { kind?: string }) => l.kind === "SERVICE",
      );
      for (const l of serviceLines) {
        await fetch(`/api/v1/purchase-orders/${poId}/receipts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lines: [{ poLineId: l.id, quantityReceived: 0, accepted: true }],
          }),
        });
      }
      setMessage(serviceLines.length ? `Accepted ${serviceLines.length} service line(s) ✓` : "No service lines");
      router.refresh();
    } catch {
      setMessage("Acceptance failed");
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/v1/purchase-orders/${poId}/pdf`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
      >
        PDF ↓
      </a>
      {canSend && status === "OPEN" && (
        <button
          onClick={send}
          disabled={busy !== null}
          className="rounded-lg bg-[var(--brand)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
        >
          {busy === "send" ? "Sending…" : "Email supplier"}
        </button>
      )}
      {hasServices && status === "OPEN" && (
        <button
          onClick={acceptServices}
          disabled={busy !== null}
          className="rounded-lg bg-purple-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          Accept work
        </button>
      )}
      {message && <span className="text-xs text-gray-500">{message}</span>}
    </div>
  );
}
