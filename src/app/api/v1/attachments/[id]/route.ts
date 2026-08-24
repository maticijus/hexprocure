import { NextResponse } from "next/server";
import { getAttachmentContent, deleteAttachment } from "@/lib/services/attachments";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getActor(request);
    const { id } = await params;
    const { row, content } = await getAttachmentContent(id);
    return new Response(new Uint8Array(content), {
      headers: {
        "content-type": row.mimeType,
        "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteAttachment(id, actor.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorToResponse(error);
  }
}
