const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-blue-50 text-blue-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  OPEN: "bg-blue-50 text-blue-700",
  CLOSED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-red-50 text-red-700",
  PENDING: "bg-gray-100 text-gray-700",
  MATCHED: "bg-green-50 text-green-700",
  EXCEPTION: "bg-amber-50 text-amber-700",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-gray-100"}`}
    >
      {status}
    </span>
  );
}

export function formatEur(minor: number): string {
  return `€${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}`;
}
