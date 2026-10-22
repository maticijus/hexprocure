"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorNote } from "@/components/ui";

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export function CsvUpload({ path, header }: { path: string; header: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch(path, { method: "POST", headers: { "content-type": "text/csv" }, body: await file.text() });
    const body = await res.json().catch(() => null);
    setBusy(false);
    e.target.value = "";
    if (!res.ok) {
      setError(body?.error?.message ?? `Upload failed (${res.status})`);
      return;
    }
    setResult(body);
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100 mb-6 space-y-3">
      <h2 className="text-sm font-semibold">Import from a CSV file</h2>
      <p className="text-sm text-gray-500">
        First line must be <code>{header}</code>. Rows are matched by name: new names are added, known names are
        updated. Up to 2,000 rows and 1 MB.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={upload} disabled={busy} className="text-sm" />
      <ErrorNote message={error} />
      {result && (
        <div className="text-sm">
          <p>
            Added {result.created}, updated {result.updated}, unchanged {result.skipped}.
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {result.errors.map((err) => (
                <li key={err.row}>Line {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
