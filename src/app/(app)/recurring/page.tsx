"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface TemplateRow {
  id: string;
  name: string;
  cadence: string;
  nextRunDate: string;
  active: boolean;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none";
const labelCls = "block text-sm font-medium text-gray-700";

export default function RecurringPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [options, setOptions] = useState<{ suppliers: { id: string; name: string }[]; costCenters: { id: string; name: string }[] }>({ suppliers: [], costCenters: [] });
  const [form, setForm] = useState({
    name: "",
    supplierId: "",
    costCenterId: "",
    cadence: "MONTHLY",
    nextRunDate: new Date().toISOString().slice(0, 10),
    description: "",
    quantity: 1,
    unitPriceMinor: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/v1/order-templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    fetch("/api/v1/meta/options")
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => {});
  }, [load]);

  async function create() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/v1/order-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        supplierId: form.supplierId,
        costCenterId: form.costCenterId,
        cadence: form.cadence,
        nextRunDate: form.nextRunDate,
        lines: [
          {
            description: form.description,
            quantity: form.quantity,
            unitPriceMinor: Math.round(parseFloat(form.unitPriceMinor || "0") * 100),
          },
        ],
      }),
    });
    if (res.status === 201) {
      setMessage("Template created ✓");
      load();
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      setMessage(d?.error?.message ?? "Creation failed");
    }
    setBusy(false);
  }

  async function runNow() {
    if (!confirm("Generate DRAFT requisitions for all due templates now?")) return;
    setBusy(true);
    const res = await fetch("/api/v1/order-templates/run", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Generated ${data.created} draft requisition(s)` : data?.error?.message ?? "Run failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      <div>
        <h1 className="text-xl font-bold mb-6">Recurring Orders</h1>
        <div className="rounded-xl bg-white shadow-sm border border-gray-100 divide-y divide-gray-50">
          {templates.map((t) => (
            <div key={t.id} className="px-5 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-gray-500">
                  {t.cadence.toLowerCase()} · next run {t.nextRunDate}
                </div>
              </div>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                  t.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.active ? "ACTIVE" : "PAUSED"}
              </span>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-gray-400">No templates yet</p>
          )}
        </div>
        <button
          onClick={runNow}
          disabled={busy}
          className="mt-4 rounded-lg bg-white border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Run due templates now
        </button>
        {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="rounded-xl bg-white p-5 shadow-sm border border-gray-100 space-y-4 self-start"
      >
        <h2 className="font-semibold">New template</h2>
        <label className={labelCls}>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="SaaS renewals" />
        </label>
        <label className={labelCls}>
          Supplier
          <select required value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={labelCls}>
          Cost center
          <select required value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {options.costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelCls}>
            Cadence
            <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} className={inputCls}>
              <option>MONTHLY</option><option>QUARTERLY</option><option>YEARLY</option>
            </select>
          </label>
          <label className={labelCls}>
            First run
            <input type="date" required value={form.nextRunDate} onChange={(e) => setForm({ ...form, nextRunDate: e.target.value })} className={inputCls} />
          </label>
        </div>
        <label className={labelCls}>
          Line description
          <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelCls}>
            Quantity
            <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) })} className={inputCls} />
          </label>
          <label className={labelCls}>
            Unit price (€)
            <input type="number" step="0.01" min="0" required value={form.unitPriceMinor} onChange={(e) => setForm({ ...form, unitPriceMinor: e.target.value })} className={inputCls} />
          </label>
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-[var(--brand)] py-2.5 font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50">
          Create template
        </button>
      </form>
    </div>
  );
}
