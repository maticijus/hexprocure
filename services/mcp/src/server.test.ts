import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiClient } from "./api.js";
import { createServer } from "./server.js";

const TOKEN = "hxp_secret_token_value";
const BASE = "https://hex.example.com";
const ID = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function connect(respond: () => Response | Promise<Response> = () => jsonResponse({})) {
  const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) => respond());
  const api = createApiClient({ baseUrl: BASE, token: TOKEN, timeoutMs: 5000 }, fetchMock as unknown as typeof fetch);
  const server = createServer(api);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, fetchMock };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

describe("server", () => {
  it("lists the seven read tools and the two resource templates", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_invoice",
      "get_purchase_order",
      "get_requisition",
      "list_invoices",
      "list_purchase_orders",
      "list_requisitions",
      "spend_summary",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const templates = (await client.listResourceTemplates()).resourceTemplates;
    expect(templates.map((t) => t.uriTemplate).sort()).toEqual(["hexprocure://invoice/{id}", "hexprocure://po/{id}"]);
  });
});

const CASES: [string, Record<string, unknown>, string][] = [
  ["list_requisitions", { status: "APPROVED", cost_center_id: ID, limit: 5 }, `/api/v1/requisitions?status=APPROVED&costCenterId=${ID}&limit=5`],
  ["list_requisitions", {}, "/api/v1/requisitions"],
  ["get_requisition", { id: ID }, `/api/v1/requisitions/${ID}`],
  ["list_purchase_orders", { status: "OPEN", supplier_id: ID, limit: 10 }, `/api/v1/purchase-orders?status=OPEN&supplierId=${ID}&limit=10`],
  ["get_purchase_order", { id: ID }, `/api/v1/purchase-orders/${ID}`],
  ["list_invoices", { status: "EXCEPTION", limit: 20 }, "/api/v1/invoices?status=EXCEPTION&limit=20"],
  ["get_invoice", { id: ID }, `/api/v1/invoices/${ID}`],
  ["spend_summary", { group_by: "costCenter", from: "2026-01-01", to: "2026-03-31" }, "/api/v1/analytics/spend?groupBy=costCenter&from=2026-01-01&to=2026-03-31"],
];

describe("tools build the right request", () => {
  it.each(CASES)("%s %j", async (name, args, path) => {
    const { client, fetchMock } = await connect();
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}${path}`);
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, Accept: "application/json" });
  });

  it("rejects invalid input without calling the API", async () => {
    const { client, fetchMock } = await connect();
    for (const [name, args] of [
      ["get_invoice", { id: "nope" }],
      ["list_invoices", { status: "BOGUS" }],
      ["list_requisitions", { limit: 101 }],
      ["spend_summary", { from: "yesterday" }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args }).catch(() => ({ isError: true }));
      expect(res.isError).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("parses an envelope and formats minor units in the row currency", async () => {
    const { client } = await connect(() =>
      jsonResponse({
        invoices: [
          { id: ID, number: "INV-1", status: "EXCEPTION", currency: "CZK", totalMinor: 123456 },
          { id: ID, number: "INV-2", status: "MATCHED", currency: "EUR", totalMinor: 1999 },
        ],
        limit: 50,
        offset: 0,
      }),
    );
    const out = JSON.parse(text(await client.callTool({ name: "list_invoices", arguments: {} })));
    expect(out.invoices[0]).toMatchObject({ totalMinor: 123456, totalFormatted: expect.stringContaining("1,234.56") });
    expect(out.invoices[0].totalFormatted).toContain("CZK");
    expect(out.invoices[1].totalFormatted).toBe("€19.99");
    expect(out.limit).toBe(50);
  });

  it("formats nested line amounts with the header currency", async () => {
    const { client } = await connect(() =>
      jsonResponse({ id: ID, currency: "EUR", totalMinor: 3000, exceptions: [], lines: [{ unitPriceMinor: 1000 }] }),
    );
    const out = JSON.parse(text(await client.callTool({ name: "get_invoice", arguments: { id: ID } })));
    expect(out.lines[0].unitPriceFormatted).toBe("€10.00");
  });
});

describe("API errors become tool errors", () => {
  it.each([
    [401, "UNAUTHENTICATED", "Not authorised (HTTP 401"],
    [403, "FORBIDDEN", "Not authorised (HTTP 403"],
    [404, "NOT_FOUND", "Not found (HTTP 404"],
    [429, "RATE_LIMITED", "Rate limited (HTTP 429"],
    [500, "INTERNAL", "HexProcure API error (HTTP 500"],
  ])("%i %s", async (status, code, expected) => {
    const { client } = await connect(() => jsonResponse({ error: { code, message: "boom" } }, status));
    const res = await client.callTool({ name: "get_requisition", arguments: { id: ID } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain(expected);
    expect(text(res)).toContain(code);
    expect(text(res)).not.toContain(TOKEN);
    expect(text(res)).not.toMatch(/bearer/i);
  });

  it("handles a non-JSON error body, a network failure and a timeout", async () => {
    let r = await (await connect(() => new Response("<html>", { status: 502 }))).client.callTool({
      name: "list_invoices",
      arguments: {},
    });
    expect(text(r)).toContain("HTTP 502");
    r = await (await connect(() => Promise.reject(new TypeError("fetch failed")))).client.callTool({
      name: "list_invoices",
      arguments: {},
    });
    expect(text(r)).toContain("NETWORK");
    r = await (
      await connect(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })))
    ).client.callTool({ name: "list_invoices", arguments: {} });
    expect(text(r)).toContain("TIMEOUT");
  });
});

describe("resources", () => {
  it("reads po and invoice documents as the get tools do", async () => {
    const { client, fetchMock } = await connect(() => jsonResponse({ id: ID, currency: "EUR", totalMinor: 500 }));
    const po = await client.readResource({ uri: `hexprocure://po/${ID}` });
    const inv = await client.readResource({ uri: `hexprocure://invoice/${ID}` });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/v1/purchase-orders/${ID}`);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${BASE}/api/v1/invoices/${ID}`);
    expect(JSON.parse(po.contents[0].text as string)).toMatchObject({ totalFormatted: "€5.00" });
    expect(inv.contents[0].mimeType).toBe("application/json");
  });

  it("errors for a malformed id and an API 404", async () => {
    const { client } = await connect(() => jsonResponse({ error: { code: "NOT_FOUND", message: "gone" } }, 404));
    await expect(client.readResource({ uri: "hexprocure://po/nope" })).rejects.toThrow(/UUID/);
    await expect(client.readResource({ uri: `hexprocure://po/${ID}` })).rejects.toThrow(/Not found/);
  });
});
