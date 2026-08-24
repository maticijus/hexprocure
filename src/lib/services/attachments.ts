import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, invoices, purchaseOrders, requisitions, users } from "@/lib/db/schema";
import { DomainError } from "./p2p";
import { LocalFileStore, type FileStore } from "@/lib/storage/file-store";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/zip",
]);

export type AttachmentEntityType = "requisition" | "purchase_order" | "invoice";

let defaultStore: FileStore | null = null;

function getDefaultStore(): FileStore {
  if (!defaultStore) {
    const dataDir = process.env.DATA_DIR ?? ".data/uploads";
    defaultStore = new LocalFileStore(dataDir);
  }
  return defaultStore;
}

export function setFileStoreForTesting(store: FileStore): void {
  defaultStore = store;
}

async function assertEntityExists(
  entityType: AttachmentEntityType,
  entityId: string,
  tx: typeof db,
): Promise<void> {
  switch (entityType) {
    case "requisition": {
      const [row] = await tx.select().from(requisitions).where(eq(requisitions.id, entityId));
      if (!row) break;
      return;
    }
    case "purchase_order": {
      const [row] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, entityId));
      if (!row) break;
      return;
    }
    case "invoice": {
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, entityId));
      if (!row) break;
      return;
    }
  }
  throw new DomainError("NOT_FOUND", `${entityType} ${entityId} does not exist`);
}

export interface UploadInput {
  content: Buffer;
  filename: string;
  mimeType: string;
  entityType: AttachmentEntityType;
  entityId: string;
  actorUserId: string;
}

export async function uploadAttachment(
  input: UploadInput,
  store: FileStore = getDefaultStore(),
) {
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new DomainError(
      "VALIDATION",
      `MIME type ${input.mimeType} is not allowed (allowed: pdf, png, jpeg, webp, txt, zip)`,
    );
  }
  if (input.content.length === 0) {
    throw new DomainError("VALIDATION", "Cannot upload an empty file");
  }
  if (input.content.length > MAX_BYTES) {
    throw new DomainError("VALIDATION", "File exceeds the 10 MB limit");
  }

  await assertEntityExists(input.entityType, input.entityId, db);

  // validate actor exists
  const [actor] = await db.select().from(users).where(eq(users.id, input.actorUserId));
  if (!actor) throw new DomainError("NOT_FOUND", "Unknown user");

  const storageKey = await store.put(input.content);
  const [row] = await db
    .insert(attachments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
      storageKey,
      uploadedByUserId: input.actorUserId,
    })
    .returning();
  return row;
}

export async function getAttachmentContent(
  attachmentId: string,
  store: FileStore = getDefaultStore(),
) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!row) throw new DomainError("NOT_FOUND", "Attachment not found");
  return { row, content: await store.get(row.storageKey) };
}

export async function deleteAttachment(
  attachmentId: string,
  actorUserId: string,
  store: FileStore = getDefaultStore(),
): Promise<void> {
  const [actor] = await db.select().from(users).where(eq(users.id, actorUserId));
  if (!actor) throw new DomainError("NOT_FOUND", "Unknown user");

  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!row) throw new DomainError("NOT_FOUND", "Attachment not found");

  if (row.uploadedByUserId !== actorUserId && actor.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", "Only the uploader or an admin can delete this attachment");
  }

  await store.delete(row.storageKey);
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
}
