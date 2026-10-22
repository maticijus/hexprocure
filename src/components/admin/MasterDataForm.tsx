"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INPUT } from "@/components/RequisitionLineFields";
import { ErrorNote } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
import { toMinorUnits } from "@/lib/format";

export interface FieldSpec {
  name: string;
  label: string;
  kind: "text" | "email" | "month" | "money" | "number" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

const LABEL = "block text-sm font-medium text-gray-700";

/** Builds the API body: money fields are typed in major units and sent as
 *  integer minor units of the form's currency; blank optional fields become
 *  null (an open-ended approval band, a supplier without email). */
function toBody(fields: FieldSpec[], values: Record<string, string>, currency: string) {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? "").trim();
    if (raw === "") body[f.name] = f.kind === "money" || f.kind === "email" ? null : undefined;
    else if (f.kind === "money") body[f.name] = toMinorUnits(Number(raw), currency);
    else if (f.kind === "number") body[f.name] = Number(raw);
    else body[f.name] = raw;
  }
  return body;
}

export function MasterDataForm({
  title,
  path,
  method,
  fields,
  initial = {},
  submitLabel,
  doneHref,
}: {
  title: string;
  path: string;
  method: "POST" | "PATCH";
  fields: FieldSpec[];
  initial?: Record<string, string>;
  submitLabel: string;
  doneHref: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson(method, path, toBody(fields, values, values.currency || "EUR"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (method === "POST") setValues(initial);
    router.push(doneHref);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm border border-gray-100 mb-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className={LABEL}>
            {f.label}
            {f.kind === "select" ? (
              <select
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                className={INPUT}
              >
                <option value="">Select...</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={f.kind === "money" || f.kind === "number" ? "number" : f.kind}
                step={f.kind === "money" ? "0.01" : f.kind === "number" ? "1" : undefined}
                min={f.kind === "money" || f.kind === "number" ? "0" : undefined}
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                className={INPUT}
              />
            )}
            {f.hint && <span className="mt-1 block text-xs font-normal text-gray-500">{f.hint}</span>}
          </label>
        ))}
      </div>
      <ErrorNote message={error} />
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
        >
          {busy ? "Saving..." : submitLabel}
        </button>
        {method === "PATCH" && (
          <a href={doneHref} className="text-sm text-gray-500 hover:underline">Cancel</a>
        )}
      </div>
    </form>
  );
}
