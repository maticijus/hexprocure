"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EMPTY_LINE, INPUT, RequisitionLineFields, type LineDraft } from "@/components/RequisitionLineFields";
import { ErrorNote } from "@/components/ui";
import { postJson } from "@/lib/client-api";
import { SUPPORTED_CURRENCIES, formatMoney, toMinorUnits } from "@/lib/format";
import { sumLinesMinor } from "@/lib/ui-text";

interface Option {
  id: string;
  name: string;
}

const LABEL = "block text-sm font-medium text-gray-700";

function toApiLines(lines: LineDraft[], currency: string) {
  return lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPriceMinor: toMinorUnits(parseFloat(l.unitPrice), currency),
    kind: l.kind,
  }));
}

function draftTotal(lines: LineDraft[], currency: string): number {
  const priced = lines.map((l) => ({
    quantity: l.quantity,
    unitPriceMinor: toMinorUnits(parseFloat(l.unitPrice) || 0, currency),
  }));
  return sumLinesMinor(priced);
}

export default function NewRequisitionPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [currency, setCurrency] = useState<string>("EUR");
  const [lines, setLines] = useState<LineDraft[]>([EMPTY_LINE]);
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
    const result = await postJson("/api/v1/requisitions", {
      supplierId,
      costCenterId,
      currency,
      lines: toApiLines(lines, currency),
    });
    if (result.ok) {
      router.push("/requisitions");
      router.refresh();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  const updateLine = (i: number, next: LineDraft) => setLines((ls) => ls.map((l, j) => (j === i ? next : l)));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">New Requisition</h1>
      <form onSubmit={submit} className="space-y-5 rounded-xl bg-white p-6 shadow-sm border border-gray-100">
        <label className={LABEL}>
          Supplier
          <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={INPUT}>
            <option value="">Select supplier...</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Cost Center
          <select required value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className={INPUT}>
            <option value="">Select cost center...</option>
            {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={INPUT}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {lines.map((line, i) => (
          <RequisitionLineFields
            key={i}
            line={line}
            index={i}
            currency={currency}
            canRemove={lines.length > 1}
            onChange={(next) => updateLine(i, next)}
            onRemove={() => removeLine(i)}
          />
        ))}
        <button type="button" onClick={() => setLines((ls) => [...ls, EMPTY_LINE])} className="text-sm font-semibold text-[var(--brand)] hover:underline">
          Add line
        </button>
        <div className="flex justify-between text-sm font-semibold">
          <span>Total</span>
          <span data-testid="requisition-total">{formatMoney(draftTotal(lines, currency), currency)}</span>
        </div>
        <ErrorNote message={error} />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--brand)] py-2.5 font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
        >
          {busy ? "Submitting..." : "Create Requisition"}
        </button>
      </form>
    </div>
  );
}
