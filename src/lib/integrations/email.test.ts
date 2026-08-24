import { describe, it, expect, vi } from "vitest";
import { createEmailConnector, renderNotification } from "./email";
import type { IntegrationEvent } from "./types";

const approvalEvent: IntegrationEvent = {
  id: "e1",
  type: "APPROVAL_REQUESTED",
  payload: {
    to: ["max@hex.test"],
    requisitionId: "req-1",
    supplier: "Acme GmbH",
    totalMinor: 19990,
    currency: "EUR",
  },
};

describe("renderNotification", () => {
  it("renders an approval request with amount and link path", () => {
    const mail = renderNotification(approvalEvent);
    expect(mail.subject).toContain("Approval needed");
    expect(mail.text).toContain("Acme GmbH");
    expect(mail.text).toContain("199.90");
    expect(mail.to).toEqual(["max@hex.test"]);
  });

  it("renders a decision notification to the requester", () => {
    const mail = renderNotification({
      id: "e2",
      type: "REQUISITION_DECIDED",
      payload: { to: ["rita@hex.test"], requisitionId: "req-1", decision: "APPROVED" },
    });
    expect(mail.subject).toMatch(/APPROVED/i);
    expect(mail.to).toEqual(["rita@hex.test"]);
  });

  it("lists exception types for invoice exceptions", () => {
    const mail = renderNotification({
      id: "e3",
      type: "INVOICE_EXCEPTION",
      payload: {
        to: ["fiona@hex.test"],
        invoiceNumber: "INV-9",
        exceptions: [{ type: "PRICE_MISMATCH" }, { type: "QUANTITY_MISMATCH" }],
      },
    });
    expect(mail.subject).toContain("INV-9");
    expect(mail.text).toContain("PRICE_MISMATCH");
  });

  it("throws on unknown notification event types", () => {
    expect(() =>
      renderNotification({ id: "x", type: "PO_CREATED", payload: {} }),
    ).toThrow(/unsupported/i);
  });

  it("skips silently (null) when payload has no recipients", () => {
    const mail = renderNotification({
      id: "y",
      type: "APPROVAL_REQUESTED",
      payload: { to: [], requisitionId: "r" },
    });
    expect(mail).toBeNull();
  });
});

describe("email connector", () => {
  it("sends rendered mail through the injected transport", async () => {
    const transport = vi.fn().mockResolvedValue({ messageId: "m1" });
    const connector = createEmailConnector(transport);
    expect(connector.handles).toContain("APPROVAL_REQUESTED");

    const result = await connector.deliver(approvalEvent);
    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    const mail = transport.mock.calls[0][0];
    expect(mail.to).toEqual(["max@hex.test"]);
    expect(mail.subject).toContain("Approval needed");
  });

  it("reports retryable failure when the transport throws", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const connector = createEmailConnector(transport);
    const result = await connector.deliver(approvalEvent);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.retryable).toBe(true);
    expect(!result.ok && result.error).toContain("SMTP down");
  });

  it("is a no-op success when there are no recipients", async () => {
    const transport = vi.fn();
    const connector = createEmailConnector(transport);
    const result = await connector.deliver({
      id: "z",
      type: "REQUISITION_DECIDED",
      payload: { to: [], requisitionId: "r", decision: "REJECTED" },
    });
    expect(result.ok).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
});
