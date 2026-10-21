import { csvConnector } from "./csv";
import { clearConnectors, registerConnector } from "./dispatch";
import { createEmailConnector } from "./email";
import { createQboConnector } from "./qbo-connector";
import { createWebhookConnector } from "./webhook";

/** Rebuilds the connector registry from env. Idempotent: it clears first, so
 *  the route and the scheduler can both call it on every run. */
export function registerConfiguredConnectors(): void {
  clearConnectors();
  registerConnector(csvConnector);
  registerConnector(createEmailConnector());
  if (process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET) {
    registerConnector(createQboConnector());
  }
  const webhookUrl = process.env.INTEGRATION_WEBHOOK_URL;
  if (webhookUrl) {
    registerConnector(
      createWebhookConnector({
        url: webhookUrl,
        secret: process.env.INTEGRATION_WEBHOOK_SECRET,
        handles: ["PO_CREATED", "PO_CANCELLED", "INVOICE_APPROVED"],
      }),
    );
  }
}
