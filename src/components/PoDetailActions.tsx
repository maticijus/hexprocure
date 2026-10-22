"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ErrorNote } from "@/components/ui";
import { postJson } from "@/lib/client-api";

export interface GoodsLine { id: string; description: string; remaining: number }
export interface ServiceLine { id: string; description: string; accepted: boolean }

interface Props { poId: string; open: boolean; canCancel: boolean; goods: GoodsLine[]; services: ServiceLine[] }

const BUTTON = "rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50";

export function PoDetailActions({ poId, open, canCancel, goods, services }: Props) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(path: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/v1/purchase-orders/${poId}/${path}`, payload);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setQty({});
    router.refresh();
  }

  const receive = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = goods
      .map((g) => ({ poLineId: g.id, quantityReceived: Number(qty[g.id] ?? 0) }))
      .filter((l) => l.quantityReceived > 0);
    if (lines.length === 0) return setError("Enter a quantity for at least one line");
    return send("receipts", { lines });
  };
  const accept = (lineId: string) =>
    send("receipts", { lines: [{ poLineId: lineId, quantityReceived: 0, accepted: true }] });
  const cancel = async () => {
    if (confirm("Cancel this purchase order? Its budget reservation is released.")) await send("cancel");
  };

  const receivable = goods.filter((g) => g.remaining > 0);
  return (
    <div>
      {open && receivable.length > 0 && (
        <Card title="Receive goods">
          <form onSubmit={receive} className="p-5 space-y-3">
            {receivable.map((g) => (
              <label key={g.id} className="flex items-center justify-between gap-4 text-sm">
                <span>Receive {g.description} (up to {g.remaining})</span>
                <input
                  type="number" min={0} max={g.remaining}
                  value={qty[g.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [g.id]: e.target.value })}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </label>
            ))}
            <button type="submit" disabled={busy} className={BUTTON}>Record receipt</button>
          </form>
        </Card>
      )}
      {open && services.some((s) => !s.accepted) && (
        <Card title="Accept work">
          <ul className="p-5 space-y-2 text-sm">
            {services.filter((s) => !s.accepted).map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>{s.description}</span>
                <button onClick={() => accept(s.id)} disabled={busy} className={BUTTON} aria-label={`Accept work: ${s.description}`}>
                  Accept work
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex items-center gap-3">
        {canCancel && (
          <button onClick={cancel} disabled={busy} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
            Cancel PO
          </button>
        )}
        <ErrorNote message={error} />
      </div>
    </div>
  );
}
