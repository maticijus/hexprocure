"use client";

import { currencySymbol } from "@/lib/format";

export type LineKind = "GOODS" | "SERVICE";
export interface LineDraft {
  kind: LineKind;
  description: string;
  quantity: number;
  unitPrice: string;
}

export const EMPTY_LINE: LineDraft = { kind: "GOODS", description: "", quantity: 1, unitPrice: "" };

export const INPUT =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-light)]";
const LABEL = "block text-sm font-medium text-gray-700";

interface Props {
  line: LineDraft;
  index: number;
  currency: string;
  canRemove: boolean;
  onChange: (next: LineDraft) => void;
  onRemove: () => void;
}

export function RequisitionLineFields({ line, index, currency, canRemove, onChange, onRemove }: Props) {
  const symbol = currencySymbol(currency);
  const service = line.kind === "SERVICE";
  const set = (patch: Partial<LineDraft>) => onChange({ ...line, ...patch });
  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
      <legend className="px-1 text-xs font-semibold text-gray-500">Line {index + 1}</legend>
      <label className={LABEL}>
        Description
        <input required value={line.description} onChange={(e) => set({ description: e.target.value })} className={INPUT} placeholder="What are you buying?" />
      </label>
      <div className="grid grid-cols-3 gap-4">
        <label className={LABEL}>
          Kind
          <select value={line.kind} onChange={(e) => set({ kind: e.target.value as LineKind })} className={INPUT}>
            <option value="GOODS">Goods</option>
            <option value="SERVICE">Service</option>
          </select>
        </label>
        <label className={LABEL}>
          {service ? `Total Amount (${symbol})` : "Quantity"}
          <input type="number" min={1} required value={line.quantity} onChange={(e) => set({ quantity: parseInt(e.target.value) || 0 })} className={INPUT} />
        </label>
        <label className={LABEL}>
          {service ? `Ordered Amount (${symbol})` : `Unit Price (${symbol})`}
          <input type="number" step="0.01" min="0" required value={line.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} className={INPUT} placeholder="0.00" />
        </label>
      </div>
      {canRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove line ${index + 1}`} className="text-xs text-red-600 hover:underline">
          Remove line
        </button>
      )}
    </fieldset>
  );
}
