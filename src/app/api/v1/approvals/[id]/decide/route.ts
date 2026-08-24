import { NextResponse } from "next/server";
import { decideApproval } from "@/lib/services/p2p";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await readJson<{ decision?: string; comment?: string }>(request);
    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "decision must be 'approve' or 'reject'" } },
        { status: 400 },
      );
    }
    return NextResponse.json(await decideApproval(id, actor.id, body.decision, body.comment));
  } catch (error) {
    return errorToResponse(error);
  }
}
