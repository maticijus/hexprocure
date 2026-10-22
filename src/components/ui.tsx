const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-blue-50 text-blue-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  ORDERED: "bg-gray-100 text-gray-600",
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

export const TABLE_HEAD = "text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50";

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden mb-6">
      {title && <h2 className="px-5 py-3 text-sm font-semibold border-b border-gray-100">{title}</h2>}
      {children}
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{message}</p> : null;
}
