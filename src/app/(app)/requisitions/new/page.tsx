"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Option {
  id: string;
  name: string;
}

export default function NewRequisitionPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState("");
  const [kind, setKind] = useState<"GOODS" | "SERVICE">("GOODS");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/meta/options")
      .then((r) => r.json())
      .then((d) => {
        setSuppliers(d.suppliers ?? []);
        setCostCenters(d.costCenters ?? []);
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/requisitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierId,
        costCenterId,
        currency: "EUR",
        lines: [
          {
            description,
            quantity,
            unitPriceMinor: Math.round(parseFloat(unitPrice) * 100),
            kind,
          },
        ],
      }),
    });
    if (res.ok) {
      router.push("/requisitions");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Failed to create requisition");
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-light)]";
  const label = "block text-sm font-medium text-gray-700";

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-6">New Requisition</h1>
      <form onSubmit={submit} className="space-y-5 rounded-xl bg-white p-6 shadow-sm border border-gray-100">
        <label className={label}>
          Supplier
          <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={input}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={label}>
          Cost Center
          <select required value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className={input}>
            <option value="">Select cost center…</option>
            {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={label}>
          Description
          <input required value={description} onChange={(e) => setDescription(e.target.value)} className={input} placeholder="What are you buying?" />
        </label>
        <div className="grid grid-cols-3 gap-4">
          <label className={label}>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as "GOODS" | "SERVICE")} className={input}>
              <option value="GOODS">Goods</option>
              <option value="SERVICE">Service</option>
            </select>
          </label>
          <label className={label}>
            {kind === "SERVICE" ? "Total Amount (€)" : "Quantity"}
            <input type="number" min={1} required value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value))} className={input} />
          </label>
          <label className={label}>
            {kind === "SERVICE" ? "Ordered Amount (€)" : "Unit Price (€)"}
            <input type="number" step="0.01" min="0" required value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={input} placeholder="0.00" />
          </label>
        </div>
        {error && <p className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--brand)] py-2.5 font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Create Requisition"}
        </button>
      </form>
    </div>
  );
}
