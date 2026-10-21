"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorNote } from "@/components/ui";
import { INPUT } from "@/components/RequisitionLineFields";
import { invoiceFileProblem } from "@/lib/invoice-upload";
import { postJson } from "@/lib/client-api";
import { applyExtracted, prefillLines, toInvoicePayload, unmatchedNote, type DraftLine, type PoLineOption } from "@/lib/invoice-draft";
import type { ProposedInvoiceLine } from "@/domain/invoice-lines";

export interface PoOption { id: string; label: string; supplierId: string; currency: string; lines: PoLineOption[] }

interface Extraction {
  draft: { invoiceNumber: string | null; issueDate: string | null };
  lines: ProposedInvoiceLine[];
  linesSource: string;
  warnings?: string[];
}

const LABEL = "block text-sm font-medium text-gray-700";

async function extract(file: File, purchaseOrderId: string): Promise<Extraction> {
  const form = new FormData();
  form.set("file", file);
  if (purchaseOrderId) form.set("purchaseOrderId", purchaseOrderId);
  const res = await fetch("/api/v1/invoices/extract", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Extraction failed (${res.status})`);
  return body as Extraction;
}

export function InvoiceForm({ pos }: { pos: PoOption[] }) {
  const router = useRouter();
  const [po, setPo] = useState<PoOption | null>(null);
  const [number, setNumber] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function choosePo(id: string) {
    const next = pos.find((p) => p.id === id) ?? null;
    setPo(next);
    setLines(next ? prefillLines(next.lines, next.currency) : []);
    setNotes([]);
  }

  async function onFile(file: File | undefined) {
    if (!file || !po) return setError(file ? "Choose a purchase order before uploading a file" : null);
    const problem = invoiceFileProblem(file);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const result = await extract(file, po.id);
      if (result.draft.invoiceNumber) setNumber(result.draft.invoiceNumber);
      const fromLlm = result.linesSource === "llm";
      const unmatched = fromLlm ? unmatchedNote(lines, result.lines) : null;
      if (fromLlm) setLines((current) => applyExtracted(current, result.lines, po.currency));
      setNotes([
        `Lines source: ${result.linesSource}`,
        ...(unmatched ? [unmatched] : []),
        ...(result.draft.issueDate ? [`Invoice date read from file: ${result.draft.issueDate}`] : []),
        ...(result.warnings ?? []),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    }
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return;
    setBusy(true);
    setError(null);
    const result = await postJson<{ id: string }>("/api/v1/invoices", {
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      number,
      lines: toInvoicePayload(lines, po.currency),
    });
    if (!result.ok) {
      setError(result.message);
      return setBusy(false);
    }
    router.push(`/invoices/${result.body.id}`);
  }

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl bg-white p-6 shadow-sm border border-gray-100">
      <label className={LABEL}>
        Purchase order
        <select required value={po?.id ?? ""} onChange={(e) => choosePo(e.target.value)} className={INPUT}>
          <option value="">Select purchase order...</option>
          {pos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className={LABEL}>
        Invoice number
        <input required value={number} onChange={(e) => setNumber(e.target.value)} className={INPUT} />
      </label>
      <label className={LABEL}>
        Invoice file (optional, fills the fields below)
        <input type="file" accept="application/pdf,image/*" onChange={(e) => onFile(e.target.files?.[0])} className={INPUT} />
      </label>
      {notes.length > 0 && (
        <ul className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2 list-disc list-inside">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {lines.map((l, i) => (
        <fieldset key={l.poLineId} className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-xs font-semibold text-gray-500">{l.description}</legend>
          {l.kind === "GOODS" && (
            <label className={LABEL}>
              Quantity
              <input type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={INPUT} />
            </label>
          )}
          <label className={LABEL}>
            {l.kind === "SERVICE" ? "Amount" : "Unit price"}
            <input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} className={INPUT} />
          </label>
        </fieldset>
      ))}
      <ErrorNote message={error} />
      <button type="submit" disabled={busy || !po} className="w-full rounded-lg bg-[var(--brand)] py-2.5 font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50">
        Save invoice
      </button>
    </form>
  );
}
