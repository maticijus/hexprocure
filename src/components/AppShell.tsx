"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/requisitions", label: "Requisitions", icon: "✎" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: "▤" },
  { href: "/analytics", label: "Analytics", icon: "▲" },
  { href: "/invoices", label: "Invoices", icon: "€" },
  { href: "/recurring", label: "Recurring", icon: "↻" },
  { href: "/attachments", label: "Attachments", icon: "🖇" },
  { href: "/suppliers", label: "Suppliers", icon: "☰" },
];

const ADMIN_NAV = [
  { href: "/admin/suppliers", label: "Manage suppliers", roles: ["ADMIN", "FINANCE"] },
  { href: "/admin/cost-centers", label: "Cost centers", roles: ["ADMIN"] },
  { href: "/admin/budgets", label: "Budgets", roles: ["ADMIN", "FINANCE"] },
  { href: "/admin/approval-rules", label: "Approval rules", roles: ["ADMIN"] },
];

const LINK = "flex items-center gap-3 px-6 py-2.5 text-sm transition-colors";
const ACTIVE_LINK = "bg-[var(--brand-light)] text-[var(--brand)] font-semibold border-r-3 border-[var(--brand)]";
const IDLE_LINK = "text-gray-600 hover:bg-gray-50 hover:text-gray-900";

export default function AppShell({
  user,
  children,
}: {
  user: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const adminLinks = ADMIN_NAV.filter((item) => item.roles.includes(user.role));

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <span className="text-lg font-bold text-[var(--brand)]">HexProcure</span>
        </div>
        <nav className="flex-1 py-4">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`${LINK} ${active ? ACTIVE_LINK : IDLE_LINK}`}>
                <span className="w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
          {adminLinks.length > 0 && (
            <>
              <div className="px-6 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Admin</div>
              {adminLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${LINK} ${pathname.startsWith(item.href) ? ACTIVE_LINK : IDLE_LINK}`}
                >
                  <span className="w-5" />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="border-t border-gray-100 p-4">
          <div className="text-sm font-medium text-gray-800">{user.name}</div>
          <div className="text-xs text-gray-500 mb-3">{user.role}</div>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 max-w-7xl">{children}</main>
    </div>
  );
}
