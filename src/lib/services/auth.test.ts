import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db, pool } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";

vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { hashPassword, verifyPassword } from "@/lib/auth";
import { login } from "./auth";

const verify = vi.mocked(verifyPassword);

const failure = async (email: string, password: string) =>
  login(email, password).then(
    () => null,
    (e: { code: string; message: string }) => ({ code: e.code, message: e.message }),
  );

beforeEach(async () => {
  await truncateAll();
  verify.mockClear();
});

describe("login timing equalisation", () => {
  it("verifies a password exactly once for an unknown email and for a wrong password", async () => {
    await db.insert(users).values({ name: "K", email: "known@hex.test", passwordHash: hashPassword("right-password") });

    const unknown = await failure("ghost@hex.test", "wrong-password");
    expect(verify).toHaveBeenCalledTimes(1);

    verify.mockClear();
    const wrong = await failure("known@hex.test", "wrong-password");
    expect(verify).toHaveBeenCalledTimes(1);

    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({ code: "FORBIDDEN", message: "Invalid credentials" });
  });

  it("verifies once for a user row without a password hash", async () => {
    await db.insert(users).values({ name: "N", email: "nohash@hex.test" });
    expect(await failure("nohash@hex.test", "whatever-pass")).toEqual({
      code: "FORBIDDEN",
      message: "Invalid credentials",
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

afterAll(async () => {
  await pool.end();
});
