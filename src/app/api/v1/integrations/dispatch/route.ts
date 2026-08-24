import { NextResponse } from "next/server";
import { dispatchPendingEvents } from "@/lib/integrations/dispatch";
import { csvConnector } from "@/lib/integrations/csv";
import { createWebhookConnector } from "@/lib/integrations/webhook";
import { registerConnector, clearConnectors } from "@/lib/integrations/dispatch";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN" && actor.role !== "FINANCE") {
      throw new DomainError("FORBIDDEN", "Requires ADMIN or FINANCE role");
    }
    configureConnectors();
    const result = await dispatchPendingEvents();
    return NextResponse.json(result);
  } catch (error) {
    return errorToResponse(error);
  }
}

function configureConnectors() {
  clearConnectors();
  registerConnector(csvConnector);
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
