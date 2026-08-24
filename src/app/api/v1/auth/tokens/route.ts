import { NextResponse } from "next/server";
import { createApiToken, listApiTokens } from "@/lib/services/api-tokens";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Requires ADMIN role" } },
        { status: 403 },
      );
    }
    return NextResponse.json({ tokens: await listApiTokens(actor.id) });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Requires ADMIN role" } },
        { status: 403 },
      );
    }
    const body = await readJson<{ name?: string }>(request);
    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "name is required" } },
        { status: 400 },
      );
    }
    return NextResponse.json(await createApiToken({ name: body.name, userId: actor.id }), { status: 201 });
  } catch (error) {
    return errorToResponse(error);
  }
}
