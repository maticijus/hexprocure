import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { DomainError } from "./p2p";
import {
  auditEvents,
  costCenters,
  poLines,
  purchaseOrders,
  requisitions,
  suppliers,
  users,
} from "@/lib/db/schema";

const pdfDoc = {
  Document: null,
  Page: null,
  Text: null,
  View: null,
  StyleSheet: null,
} as never as Record<string, never>;
void pdfDoc;

export interface PoPdfLine {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface PoPdfData {
  poReference: string;
  issueDate: string;
  supplierName: string;
  supplierEmail?: string;
  currency: string;
  lines: PoPdfLine[];
  totalMinor: number;
  /** internal-only fields */
  costCenter?: string;
  requesterName?: string;
}

export async function toPdfData(poId: string, forSupplier: boolean): Promise<PoPdfData> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) throw new DomainError("NOT_FOUND", "PO not found");
  const lines = await db.select().from(poLines).where(eq(poLines.purchaseOrderId, poId));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));

  let costCenter: string | undefined;
  let requesterName: string | undefined;
  if (!forSupplier) {
    const [cc] = await db.select().from(costCenters).where(eq(costCenters.id, po.costCenterId));
    costCenter = cc?.name;
    if (po.requisitionId) {
      const [req] = await db.select().from(requisitions).where(eq(requisitions.id, po.requisitionId));
      if (req) {
        const [requester] = await db.select().from(users).where(eq(users.id, req.requesterId));
        requesterName = requester?.name;
      }
    }
  }

  const pdfLines: PoPdfLine[] = lines.map((l) => ({
    description: l.description,
    quantity: l.quantityOrdered,
    unitPriceMinor: l.unitPriceMinor,
    totalMinor: l.quantityOrdered * l.unitPriceMinor,
  }));

  return {
    poReference: poId,
    issueDate: new Date(po.createdAt).toISOString().slice(0, 10),
    supplierName: supplier?.name ?? "",
    supplierEmail: supplier?.email ?? undefined,
    currency: po.currency,
    lines: pdfLines,
    totalMinor: pdfLines.reduce((s, l) => s + l.totalMinor, 0),
    ...(costCenter ? { costCenter } : {}),
    ...(requesterName ? { requesterName } : {}),
  };
}

const eur = (minor: number) =>
  `${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;

async function renderPdf(data: PoPdfData): Promise<Buffer> {
  const { Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );
  const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
    header: { fontSize: 20, bold: true, marginBottom: 4, color: "#0b5cab" },
    meta: { marginBottom: 16, color: "#444" },
    tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#ccc", paddingBottom: 4, marginBottom: 4 },
    row: { flexDirection: "row", paddingBottom: 3 },
    colDesc: { flex: 1 },
    colNum: { width: 70, textAlign: "right" },
    total: { marginTop: 12, fontSize: 12, bold: true, textAlign: "right" },
    footer: { marginTop: 30, color: "#888", fontSize: 8 },
  });

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.header }, "Purchase Order"),
      React.createElement(
        Text,
        { style: styles.meta },
        `Reference: ${data.poReference}\nDate: ${data.issueDate}\nSupplier: ${data.supplierName}`,
      ),
      data.costCenter || data.requesterName
        ? React.createElement(
            Text,
            { style: styles.meta },
            [
              data.costCenter && `Cost center: ${data.costCenter}`,
              data.requesterName && `Requested by: ${data.requesterName}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
        : null,
      React.createElement(
        View,
        { style: styles.tableHeader },
        React.createElement(Text, { style: styles.colDesc }, "Description"),
        React.createElement(Text, { style: styles.colNum }, "Qty"),
        React.createElement(Text, { style: styles.colNum }, "Unit"),
        React.createElement(Text, { style: styles.colNum }, "Total"),
      ),
      ...data.lines.map((line, i) =>
        React.createElement(
          View,
          { style: styles.row, key: i },
          React.createElement(Text, { style: styles.colDesc }, line.description),
          React.createElement(Text, { style: styles.colNum }, String(line.quantity)),
          React.createElement(
            Text,
            { style: styles.colNum },
            eur(line.unitPriceMinor),
          ),
          React.createElement(Text, { style: styles.colNum }, eur(line.totalMinor)),
        ),
      ),
      React.createElement(Text, { style: styles.total }, `Total: ${eur(data.totalMinor)}`),
      React.createElement(
        Text,
        { style: styles.footer },
        "Generated by HexProcure · This document was generated automatically and is valid without signature.",
      ),
    ),
  );

  const buffer = await renderToBuffer(doc);
  return Buffer.from(buffer);
}

const PDF_ID_RE = /\/ID \[(<[0-9a-f]+> <[0-9a-f]+>)\]/;
const PDF_DATE_RE = /\(D:\d{14}Z?\)/g;

/** react-pdf embeds a random file ID and a wall-clock creation date per render;
 *  normalize both (dates → fixed epoch, ID → hash of everything else) so
 *  identical content produces byte-identical PDFs. */
function withDeterministicId(buffer: Buffer): Buffer {
  // 1) normalize wall-clock metadata first so it cannot leak into the ID hash
  const dateNormalized = buffer.toString("latin1").replace(PDF_DATE_RE, "(D:20000101000000Z)");
  // 2) replace the random file ID with a hash of everything else
  const m = dateNormalized.match(PDF_ID_RE);
  if (!m) return Buffer.from(dateNormalized, "latin1");
  const innerStart = m.index! + "/ID [".length;
  const innerLen = m[1].length;
  const masked =
    dateNormalized.slice(0, innerStart) + "0".repeat(innerLen) + dateNormalized.slice(innerStart + innerLen);
  const digest = createHash("sha256").update(masked, "latin1").digest("hex").slice(0, innerLen);
  const finalLatin =
    dateNormalized.slice(0, innerStart) + digest + dateNormalized.slice(innerStart + innerLen);
  return Buffer.from(finalLatin, "latin1");
}

export async function buildPurchaseOrderPdf(
  poId: string,
  forSupplier: boolean,
): Promise<Buffer> {
  const data = await toPdfData(poId, forSupplier);
  return withDeterministicId(await renderPdf(data));
}

export type MailTransportLike = (message: {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}) => Promise<unknown>;

function defaultMailTransport(): MailTransportLike | null {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see note in integrations/email.ts
  const nodemailer = require("nodemailer") as {
    createTransport: (url: string) => { sendMail: (m: unknown) => Promise<unknown> };
  };
  const sender = nodemailer.createTransport(smtpUrl);
  return (message) => sender.sendMail({ ...message, from: process.env.SMTP_FROM });
}

export async function sendPurchaseOrder(
  poId: string,
  actorUserId: string,
  toOverride?: string,
  transport: MailTransportLike | null = defaultMailTransport(),
): Promise<{ sentTo: string[] }> {
  if (transport === null) throw new Error("SMTP is not configured (SMTP_URL missing)");

  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.status !== "OPEN") {
      throw new DomainError("INVALID_STATE", `Cannot send a ${po.status} PO`);
    }

    const recipient =
      toOverride?.trim() ||
      (await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId)))[0]?.email ||
      null;
    if (!recipient) {
      throw new DomainError(
        "INVALID_STATE",
        "Supplier has no email address; provide a recipient explicitly",
      );
    }

    const pdf = await buildPurchaseOrderPdf(poId, true);

    await transport({
      to: [recipient],
      subject: `Purchase Order ${poId.slice(0, 8)} — HexProcure`,
      text:
        `Please find purchase order ${poId.slice(0, 8)} attached (PDF).\n\n` +
        `HexProcure on behalf of your customer.`,
      attachments: [
        { filename: `PO-${poId.slice(0, 8)}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
    });

    await tx.insert(auditEvents).values({
      entityType: "purchase_order",
      entityId: poId,
      action: "PO_SENT",
      actorUserId,
      payload: { to: recipient },
    });

    return { sentTo: [recipient] };
  });
}
