import { NextResponse } from "next/server";
import { registerUser } from "@/lib/services/auth";
import { errorToResponse, readJson } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ name?: string; email?: string; password?: string }>(request);
    const user = await registerUser(body);
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
