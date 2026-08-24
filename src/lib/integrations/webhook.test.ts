import { describe, it, expect, vi } from "vitest";
import { createWebhookConnector } from "./webhook";

const okResponse = () => new Response("{}", { status: 200 });

describe("webhook connector", () => {
  const event = {
    id: "e1",
    type: "PO_CREATED" as const,
    payload: { purchaseOrderId: "po-1", totalMinor: 100 },
  };

  it("POSTs event JSON to the configured URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const connector = createWebhookConnector(
      { url: "https://erp.example/hook", handles: ["PO_CREATED"] },
      fetchMock,
    );
    const result = await connector.deliver(event);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://erp.example/hook",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ id: "e1", type: "PO_CREATED" });
  });

  it("marks 4xx responses non-retryable and 5xx retryable", async () => {
    const fetch400 = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    const fetch503 = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const r1 = await createWebhookConnector({ url: "u", handles: ["PO_CREATED"] }, fetch400)
      .deliver(event);
    const r2 = await createWebhookConnector({ url: "u", handles: ["PO_CREATED"] }, fetch503)
      .deliver(event);
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.retryable).toBe(false);
    expect(!r2.ok && r2.retryable).toBe(true);
  });

  it("signs payloads with HMAC-SHA256 when a secret is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const secret = "test-secret";
    const connector = createWebhookConnector(
      { url: "https://erp.example/hook", secret, handles: ["PO_CREATED"] },
      fetchMock,
    );
    await connector.deliver(event);
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["x-hexprocure-signature"]).toMatch(/^[0-9a-f]{64}$/);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = [...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(event))),
    )].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(headers["x-hexprocure-signature"]).toBe(expected);
  });

  it("treats network errors as retryable", async () => {
    const fetchFail = vi.fn().mockRejectedValue(new TypeError("network down"));
    const result = await createWebhookConnector({ url: "u", handles: ["PO_CREATED"] }, fetchFail)
      .deliver(event);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.retryable).toBe(true);
  });
});
