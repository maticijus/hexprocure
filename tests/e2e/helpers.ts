import type { Browser, Page } from "@playwright/test";
import { Pool } from "pg";

export const PASSWORD = "password123";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** POST through the page's session cookie; browser-like Origin satisfies CSRF. */
export function apiPost(page: Page, path: string, body?: unknown) {
  return page.request.post(path, {
    headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:3100" },
    data: body,
  });
}

let pool: Pool | null = null;

/** Direct DB access for fixture lookups with no HTTP surface (e.g. approval ids). */
export function dbQuery<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool.query<T>(sql, values);
}

export interface OrderedPo {
  purchaseOrderId: string;
  poLineId: string;
  requisitionId: string;
}
/** requisition → submit → MANAGER approves → order, all as Max (the approver
 *  role of the first band). Total stays under the €500 MANAGER band so a
 *  single approval step suffices. */
export async function createApprovedOrder(
  browser: Browser,
  supplierId: string,
  costCenterId: string,
): Promise<OrderedPo> {
  const page = await browser.newPage();
  await login(page, "max@hexprocure.dev");
  try {
    const createRes = await apiPost(page, "/api/v1/requisitions", {
      supplierId,
      costCenterId,
      currency: "EUR",
      lines: [{ description: "E2E widgets", quantity: 2, unitPriceMinor: 15_000 }],
    });
    if (!createRes.ok()) throw new Error(`requisition create failed: ${createRes.status()}`);
    const requisitionId = (await createRes.json()).id as string;

    const submitRes = await apiPost(page, `/api/v1/requisitions/${requisitionId}/submit`);
    if (!submitRes.ok()) throw new Error(`submit failed: ${submitRes.status()}`);

    const approval = (await dbQuery<{ id: string }>(
      "SELECT id FROM approvals WHERE requisition_id = $1",
      [requisitionId],
    )).rows[0];

    const decideRes = await apiPost(page, `/api/v1/approvals/${approval.id}/decide`, {
      decision: "approve",
    });
    if (!decideRes.ok()) throw new Error(`decide failed: ${decideRes.status()}`);

    const orderRes = await apiPost(page, `/api/v1/requisitions/${requisitionId}/order`);
    if (!orderRes.ok()) throw new Error(`order failed: ${orderRes.status()}`);
    const purchaseOrderId = (await orderRes.json()).purchaseOrderId as string;

    const lineRows = await dbQuery<{ id: string }>(
      "SELECT id FROM po_lines WHERE purchase_order_id = $1",
      [purchaseOrderId],
    );
    return { purchaseOrderId, poLineId: lineRows.rows[0].id, requisitionId };
  } finally {
    await page.close();
  }
}
