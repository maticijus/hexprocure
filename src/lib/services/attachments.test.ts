import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { seedOrg, createRequisitionWithLine, truncateAll } from "@/lib/testing/seed";
import {
  uploadAttachment,
  getAttachmentContent,
  deleteAttachment,
} from "./attachments";

beforeEach(async () => {
  await truncateAll();
});

const PDF = Buffer.from("%PDF-1.4 test-bytes");

function makeUpload(entityId: string, userId: string) {
  return {
    content: PDF,
    filename: "quote.pdf",
    mimeType: "application/pdf",
    entityType: "requisition" as const,
    entityId,
    actorUserId: userId,
  };
}

describe("uploadAttachment", () => {
  it("stores bytes and returns the attachment row", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const result = await uploadAttachment(makeUpload(req.id, s.requester.id));

    expect(result.filename).toBe("quote.pdf");
    expect(result.sizeBytes).toBe(PDF.length);

    const [row] = await db.select().from(attachments);
    expect(row.storageKey).toBeTruthy();
    expect(row.entityType).toBe("requisition");
  });

  it("rejects disallowed MIME types", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    await expect(
      uploadAttachment({ ...makeUpload(req.id, s.requester.id), mimeType: "application/x-msdownload" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects files over 10 MB without touching storage", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const big = { ...makeUpload(req.id, s.requester.id), content: Buffer.alloc(10 * 1024 * 1024 + 1) };
    await expect(uploadAttachment(big)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects unknown entities", async () => {
    const s = await seedOrg();
    await expect(
      uploadAttachment(makeUpload("00000000-0000-0000-0000-000000000000", s.requester.id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getAttachmentContent", () => {
  it("returns row plus original bytes", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const uploaded = await uploadAttachment(makeUpload(req.id, s.requester.id));

    const { row, content } = await getAttachmentContent(uploaded.id);
    expect(row.filename).toBe("quote.pdf");
    expect(content.equals(PDF)).toBe(true);
  });

  it("404s on unknown id", async () => {
    await expect(
      getAttachmentContent("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteAttachment", () => {
  it("allows the uploader to delete", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const uploaded = await uploadAttachment(makeUpload(req.id, s.requester.id));

    await deleteAttachment(uploaded.id, s.requester.id);
    const rows = await db.select().from(attachments);
    expect(rows).toHaveLength(0);
  });

  it("forbids non-uploader non-admin deletion", async () => {
    const s = await seedOrg();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const uploaded = await uploadAttachment(makeUpload(req.id, s.requester.id));

    await expect(deleteAttachment(uploaded.id, s.manager.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const rows = await db.select().from(attachments).where(eq(attachments.id, uploaded.id));
    expect(rows).toHaveLength(1);
  });

  it("allows ADMIN to delete anyone's attachment", async () => {
    const s = await seedOrg();
    const [admin] = await db
      .insert(await import("@/lib/db/schema").then((m) => m.users))
      .values({ name: "A", email: `a-${Date.now()}@hex.test`, role: "ADMIN" })
      .returning();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 100);
    const uploaded = await uploadAttachment(makeUpload(req.id, s.requester.id));

    await deleteAttachment(uploaded.id, admin.id);
    const rows = await db.select().from(attachments);
    expect(rows).toHaveLength(0);
  });
});

afterAll(async () => {
  await pool.end();
});
