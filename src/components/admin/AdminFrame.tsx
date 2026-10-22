import { getCurrentUser } from "@/lib/session";

type Role = "REQUESTER" | "MANAGER" | "FINANCE" | "ADMIN";

/** Returns the current user when their role may manage this page, else null.
 *  The API enforces the same roles; this keeps the page from rendering forms
 *  that would only fail. */
export async function userWithRole(roles: readonly Role[]) {
  const user = await getCurrentUser();
  return user && roles.includes(user.role) ? user : null;
}

export function NoAccess({ title, who }: { title: string; who: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">{title}</h1>
      <p className="rounded-xl bg-white p-6 shadow-sm border border-gray-100 text-gray-500">
        This page is available to {who}.
      </p>
    </div>
  );
}
