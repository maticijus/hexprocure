"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AttachmentRow {
  id: string;
  entityType: string;
  entityId: string;
  filename: string;
  sizeBytes: number;
}

const ENTITY_TYPES = [
  { value: "requisition", label: "Requisition" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "invoice", label: "Invoice" },
];

export default function AttachmentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [entityType, setEntityType] = useState("requisition");
  const [entities, setEntities] = useState<{ id: string; label: string }[]>([]);
  const [entityId, setEntityId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [listTick, setListTick] = useState(0);
  const reloadList = () => setListTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/attachments")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRows(d.attachments ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listTick]);

  const loadEntities = useCallback((type: string) => {
    if (!type) return;
    fetch(`/api/v1/meta/entities?type=${type}`)
      .then((r) => r.json())
      .then((d) => setEntities(d.entities ?? []))
      .catch(() => setEntities([]));
  }, []);

  useEffect(() => {
    loadEntities(entityType);
  }, [entityType, loadEntities]);

  async function upload() {
    if (!file || !entityId) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    form.append("entityType", entityType);
    form.append("entityId", entityId);
    const res = await fetch("/api/v1/attachments", { method: "POST", body: form });
    if (res.ok) {
      setMessage("Uploaded ✓");
      setFile(null);
      const input = document.getElementById("file-input") as HTMLInputElement | null;
      if (input) input.value = "";
      reloadList();
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      setMessage(d?.error?.message ?? "Upload failed");
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this attachment?")) return;
    const res = await fetch(`/api/v1/attachments/${id}`, { method: "DELETE" });
    if (res.ok) reloadList();
    else setMessage("Delete failed");
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none";

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">Attachments</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          upload();
        }}
        className="rounded-xl bg-white p-5 shadow-sm border border-gray-100 space-y-4 mb-8"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium text-gray-700">
            Document type
            <select
              value={entityType}
              onChange={(e) => {
                setEntityId("");
                setEntityType(e.target.value);
              }}
              className={`mt-1 ${inputCls}`}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Attach to
            <select required value={entityId} onChange={(e) => setEntityId(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="">Select…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700">
          File (pdf/png/jpeg/webp/txt/zip · max 10 MB)
          <input
            id="file-input"
            type="file"
            required
            accept=".pdf,.png,.jpeg,.jpg,.webp,.txt,.zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={`mt-1 w-full text-sm ${inputCls}`}
          />
        </label>
        {message && <p className="text-sm text-gray-600">{message}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)] disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      <h2 className="font-semibold mb-3">Recent attachments</h2>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 divide-y divide-gray-50">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <a href={`/api/v1/attachments/${r.id}`} className="text-sm font-medium hover:text-[var(--brand)]">
                {r.filename}
              </a>
              <div className="text-xs text-gray-400">
                {r.entityType.replace("_", " ")} · {(r.sizeBytes / 1024).toFixed(1)} KB
              </div>
            </div>
            <button onClick={() => remove(r.id)} className="text-xs text-red-500 hover:underline">
              Delete
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-gray-400">No attachments yet</p>
        )}
      </div>
    </div>
  );
}
