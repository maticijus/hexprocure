import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ApiClient, describeError } from "./api.js";
import { withFormattedMoney } from "./money.js";

const limit = z.number().int().min(1).max(100).optional().describe("Max rows, 1 to 100 (default 50)");
const id = z.uuid();

const REQUISITION_STATUS = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ORDERED"] as const;
const PO_STATUS = ["OPEN", "CLOSED", "CANCELLED"] as const;
const INVOICE_STATUS = ["PENDING", "MATCHED", "EXCEPTION", "APPROVED"] as const;

const json = (value: unknown) => JSON.stringify(withFormattedMoney(value), null, 2);

export function createServer(client: ApiClient): McpServer {
  const server = new McpServer({ name: "hexprocure", version: "0.1.0" });

  function read<S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    request: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      { description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
      // the SDK validates args against inputSchema before calling; the generic S defeats its callback typing
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          return { content: [{ type: "text" as const, text: json(await request(args)) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text" as const, text: describeError(error) }] };
        }
      }) as never,
    );
  }

  read(
    "list_requisitions",
    "List purchase requisitions, newest first. Amounts are minor units plus a formatted string in the row currency.",
    { status: z.enum(REQUISITION_STATUS).optional(), cost_center_id: id.optional(), limit },
    (a) => client.get("/requisitions", { status: a.status, costCenterId: a.cost_center_id, limit: a.limit }),
  );
  read(
    "get_requisition",
    "Get one requisition with its lines, approval steps and linked purchase order id.",
    { id },
    (a) => client.get(`/requisitions/${a.id}`),
  );
  read(
    "list_purchase_orders",
    "List purchase orders, newest first.",
    { status: z.enum(PO_STATUS).optional(), supplier_id: id.optional(), limit },
    (a) => client.get("/purchase-orders", { status: a.status, supplierId: a.supplier_id, limit: a.limit }),
  );
  read(
    "get_purchase_order",
    "Get one purchase order with lines: ordered, received, accepted and invoiced quantities.",
    { id },
    (a) => client.get(`/purchase-orders/${a.id}`),
  );
  read(
    "list_invoices",
    "List supplier invoices, newest first.",
    { status: z.enum(INVOICE_STATUS).optional(), limit },
    (a) => client.get("/invoices", { status: a.status, limit: a.limit }),
  );
  read(
    "get_invoice",
    "Get one invoice with its lines and three-way match exceptions.",
    { id },
    (a) => client.get(`/invoices/${a.id}`),
  );
  read(
    "spend_summary",
    "Approved-invoice spend grouped by supplier, cost center or month, per currency. Needs a FINANCE or ADMIN token.",
    {
      group_by: z.enum(["supplier", "costCenter", "month"]).optional().describe("Default supplier"),
      from: z.iso.date().optional().describe("YYYY-MM-DD"),
      to: z.iso.date().optional().describe("YYYY-MM-DD"),
    },
    (a) => client.get("/analytics/spend", { groupBy: a.group_by, from: a.from, to: a.to }),
  );

  const resource = (name: string, scheme: string, path: string) =>
    server.registerResource(
      name,
      new ResourceTemplate(`hexprocure://${scheme}/{id}`, { list: undefined }),
      { description: `${name} as JSON, same payload as the get tool`, mimeType: "application/json" },
      async (uri, variables) => {
        const parsed = id.safeParse(variables.id);
        if (!parsed.success) throw new Error("Resource id must be a UUID");
        try {
          const body = await client.get(`${path}/${parsed.data}`);
          return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(body) }] };
        } catch (error) {
          throw new Error(describeError(error));
        }
      },
    );
  resource("purchase-order", "po", "/purchase-orders");
  resource("invoice", "invoice", "/invoices");

  return server;
}
