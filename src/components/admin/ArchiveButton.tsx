"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-api";

/** Two clicks to archive: the first asks, the second confirms. */
export function ArchiveButton({ path }: { path: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    if (!armed) {
      setArmed(true);
      return;
    }
    const result = await postJson(path);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={archive} className="text-sm font-semibold text-red-600 hover:underline">
        {armed ? "Confirm archive" : "Archive"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
