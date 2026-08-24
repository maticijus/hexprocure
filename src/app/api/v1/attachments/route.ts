import { NextResponse } from "next/server";
import { listAttachments, uploadAttachment, type AttachmentEntityType } from "@/lib/services/attachments";
import { errorToResponse, getActor } from "@/lib/api/helpers";

const ENTITY_TYPES = new Set(["requisition", "purchase_order", "invoice"]);

export async function GET(request: Request) {
  try {
    await getActor(request);
    const rows = await listAttachments();
    return NextResponse.json({
      attachments: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        uploadedByUserId: r.uploadedByUserId,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const form = await request.formData();
    const file = form.get("file");
    const entityType = String(form.get("entityType") ?? "");
    const entityId = String(form.get("entityId") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "multipart field 'file' is required" } },
        { status: 400 },
      );
    }
    if (!ENTITY_TYPES.has(entityType)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "entityType must be requisition, purchase_order, or invoice" } },
        { status: 400 },
      );
    }

    const content = Buffer.from(await file.arrayBuffer());
    const row = await uploadAttachment({
      content,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      entityType: entityType as AttachmentEntityType,
      entityId,
      actorUserId: actor.id,
    });
    return NextResponse.json(
      { id: row.id, filename: row.filename, sizeBytes: row.sizeBytes },
      { status: 201 },
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
