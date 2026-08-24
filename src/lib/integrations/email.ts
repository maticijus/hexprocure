import type { Connector, IntegrationEvent } from "./types";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

export type MailTransport = (message: MailMessage) => Promise<unknown>;

const eur = (minor: unknown) =>
  `€${(Number(minor ?? 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}`;

type NotificationEvent = Extract<
  IntegrationEvent["type"],
  "APPROVAL_REQUESTED" | "REQUISITION_DECIDED" | "INVOICE_EXCEPTION"
>;

const NOTIFICATION_TYPES: NotificationEvent[] = [
  "APPROVAL_REQUESTED",
  "REQUISITION_DECIDED",
  "INVOICE_EXCEPTION",
];

/** Renders a notification event into a mail message.
 *  Returns null when there are no recipients — nothing to deliver. */
export function renderNotification(event: IntegrationEvent): MailMessage | null {
  if (!NOTIFICATION_TYPES.includes(event.type as NotificationEvent)) {
    throw new Error(`Unsupported notification event type: ${event.type}`);
  }
  const p = event.payload as Record<string, unknown>;
  const to = Array.isArray(p.to) ? (p.to as string[]).filter(Boolean) : [];
  if (to.length === 0) return null;

  switch (event.type) {
    case "APPROVAL_REQUESTED":
      return {
        to,
        subject: `Approval needed: ${p.supplier ?? "requisition"} ${eur(p.totalMinor)}`,
        text:
          `A requisition from ${p.supplier ?? "a supplier"} for ${eur(p.totalMinor)} ` +
          `is waiting for your approval.\n` +
          `Open it in HexProcure → Approvals (requisition ${p.requisitionId}).`,
      };
    case "REQUISITION_DECIDED":
      return {
        to,
        subject: `Your requisition was ${String(p.decision ?? "decided").toUpperCase()}`,
        text:
          `Requisition ${p.requisitionId} has been ` +
          `${String(p.decision ?? "decided").toUpperCase()}.`,
      };
    case "INVOICE_EXCEPTION": {
      const exceptions = Array.isArray(p.exceptions)
        ? (p.exceptions as { type?: string }[]).map((e) => e.type).filter(Boolean)
        : [];
      return {
        to,
        subject: `Invoice exception: ${String(p.invoiceNumber ?? event.id)}`,
        text:
          `Invoice ${p.invoiceNumber ?? event.id} failed matching and needs review.\n` +
          `Exceptions: ${exceptions.join(", ") || "see details in HexProcure"}.\n` +
          `Open it in HexProcure → Invoices.`,
      };
    }
    default:
      throw new Error(`Unsupported notification event type: ${event.type}`);
  }
}

/** Notification connector: delivers rendered mails via the injected transport
 *  (nodemailer in production, fakes in tests). Log-only when transport is absent. */
export function createEmailConnector(
  transport: MailTransport | null = defaultTransport(),
): Connector {
  const handles = [...NOTIFICATION_TYPES] as Connector["handles"];
  return {
    name: "email",
    handles,
    async deliver(event) {
      const mail = renderNotification(event);
      if (!mail) return { ok: true };

      if (!transport) {
        console.log(`[email:no-op] Would send to ${mail.to.join(",")}: ${mail.subject}`);
        return { ok: true, response: { skipped: true } };
      }
      try {
        await transport(mail);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error), retryable: true };
      }
    },
  };
}

function defaultTransport(): MailTransport | null {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) return null;
  // Lazy require keeps nodemailer out of every test path; only loaded when
  // SMTP_URL is configured. Kept dynamic so the dependency stays optional at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
  const nodemailer = require("nodemailer") as {
    createTransport: (url: string) => { sendMail: (m: MailMessage) => Promise<unknown> };
  };
  const sender = nodemailer.createTransport(smtpUrl);
  return (message) =>
    sender.sendMail({ ...message, from: process.env.SMTP_FROM } as MailMessage & {
      from?: string;
    });
}
