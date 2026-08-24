import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword, createSessionToken } from "@/lib/auth";
import { DomainError } from "@/lib/services/p2p";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error("AUTH_SECRET must be set (min 8 chars)");
  }
  return secret;
}

export async function registerUser(input: {
  name?: string;
  email?: string;
  password?: string;
  role?: "REQUESTER" | "MANAGER" | "FINANCE" | "ADMIN";
}) {
  if (!input.email || !EMAIL_RE.test(input.email)) {
    throw new DomainError("INVALID_STATE", "A valid email is required");
  }
  if (!input.password || input.password.length < 8) {
    throw new DomainError("INVALID_STATE", "Password must be at least 8 characters");
  }
  const [existing] = await db.select().from(users).where(eq(users.email, input.email));
  if (existing) {
    throw new DomainError("INVALID_STATE", "Email already registered");
  }
  const [user] = await db
    .insert(users)
    .values({
      name: input.name?.trim() || input.email.split("@")[0],
      email: input.email.toLowerCase(),
      passwordHash: hashPassword(input.password),
      role: input.role ?? "REQUESTER",
    })
    .returning();
  return user;
}

export async function login(email: string | undefined, password: string | undefined): Promise<string> {
  if (!email || !password) {
    throw new DomainError("FORBIDDEN", "Email and password are required");
  }
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new DomainError("FORBIDDEN", "Invalid credentials");
  }
  return createSessionToken(user.id, requireSecret());
}
