export interface IntegrationEvent {
  id: string;
  type:
    | "PO_CREATED"
    | "PO_CANCELLED"
    | "INVOICE_APPROVED"
    | "APPROVAL_REQUESTED"
    | "REQUISITION_DECIDED"
    | "INVOICE_EXCEPTION";
  payload: Record<string, unknown>;
}

export type DeliveryStatus =
  | { ok: true; response?: Record<string, unknown> }
  | { ok: false; error: string; retryable: boolean };

/** A target ERP/AP system. Implementations translate HexProcure events
 *  into the target system's format and deliver them. */
export interface Connector {
  readonly name: string;
  /** Which event types this connector consumes. */
  handles: IntegrationEvent["type"][];
  deliver(event: IntegrationEvent): Promise<DeliveryStatus>;
}
