import { NextResponse } from "next/server";
import { registerUser, selfRegistrationAllowed } from "@/lib/services/auth";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, readJson } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    if (!selfRegistrationAllowed()) {
      throw new DomainError("FORBIDDEN", "Self-registration is disabled");
    }
    const body = await readJson<{ name?: string; email?: string; password?: string }>(request);
    const { name, email, password } = body;
    const user = await registerUser({ name, email, password });
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
