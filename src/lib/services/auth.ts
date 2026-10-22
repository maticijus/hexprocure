import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { startSession, purgeExpiredSessions } from "@/lib/services/sessions";
import { DomainError } from "@/lib/services/p2p";

/** Verified against when no account matches, so unknown and known emails do
 *  the same scrypt work and timing does not reveal which accounts exist. */
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Production must opt in explicitly; elsewhere registration is open unless disabled. */
export function selfRegistrationAllowed(): boolean {
  const flag = process.env.ALLOW_SELF_REGISTRATION;
  if (process.env.NODE_ENV === "production") return flag === "true";
  return flag !== "false";
}

export async function registerUser(input: {
  name?: string;
  email?: string;
  password?: string;
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
      role: "REQUESTER",
    })
    .returning();
  return user;
}

export async function login(
  email: string | undefined,
  password: string | undefined,
  userAgent?: string | null,
): Promise<string> {
  if (!email || !password) {
    throw new DomainError("FORBIDDEN", "Email and password are required");
  }
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const verified = verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.passwordHash || !verified) {
    throw new DomainError("FORBIDDEN", "Invalid credentials");
  }
  await purgeExpiredSessions();
  return startSession(user.id, userAgent);
}
