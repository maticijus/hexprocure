"use client";

import { useEffect, useState } from "react";

interface QboStatus {
  connected: boolean;
  status: string;
  refreshExpiresAt: string | null;
}

export function QboStatusCard({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/integrations/qbo/status")
      .then((r) => (r.ok ? r.json() : { status: "NOT_CONFIGURED" }))
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ connected: false, status: "NOT_CONFIGURED", refreshExpiresAt: null });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function disconnect() {
    if (!confirm("Disconnect QuickBooks? Stored tokens will be wiped.")) return;
    await fetch("/api/v1/integrations/qbo/disconnect", { method: "POST" });
    reload();
  }

  if (loading) return null;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100 flex items-center justify-between">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">QuickBooks Online</div>
        <div className="mt-1 text-sm">
          {status?.connected ? (
            <span className="text-green-700 font-semibold">Connected</span>
          ) : (
            <span className="text-gray-500">{status?.status ?? "Not connected"}</span>
          )}
        </div>
        {status?.connected && status.refreshExpiresAt && (
          <div className="text-xs text-gray-400">
            Re-auth needed by {new Date(status.refreshExpiresAt).toLocaleDateString("en-GB")}
          </div>
        )}
      </div>
      <div>
        {!status?.connected && isAdmin && (
          <a
            href="/api/v1/integrations/qbo/connect"
            className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--brand-dark)]"
          >
            Connect
          </a>
        )}
        {status?.connected && isAdmin && (
          <button onClick={disconnect} className="text-xs text-red-500 hover:underline">
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
