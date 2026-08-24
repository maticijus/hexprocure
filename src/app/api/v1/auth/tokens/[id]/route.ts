import { NextResponse } from "next/server";
import { revokeApiToken } from "@/lib/services/api-tokens";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Requires ADMIN role" } },
        { status: 403 },
      );
    }
    const { id } = await params;
    await revokeApiToken(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorToResponse(error);
  }
}
