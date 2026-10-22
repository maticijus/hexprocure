import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { DomainError } from "@/lib/services/p2p";
import { resetLicenseCache } from "@/lib/license";

const actor = vi.hoisted(() => ({ role: "ADMIN" as string | null }));

vi.mock("@/lib/api/helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/helpers")>()),
  getActor: vi.fn(async () => {
    if (!actor.role) throw new DomainError("FORBIDDEN", "Authentication required");
    return { id: "u1", role: actor.role };
  }),
}));

import { GET } from "./route";

const call = () => GET(new Request("http://localhost/api/v1/license"));

afterEach(() => {
  actor.role = "ADMIN";
  delete process.env.HEXPROCURE_LICENSE;
  resetLicenseCache();
});

describe("GET /api/v1/license", () => {
  it("rejects unauthenticated callers", async () => {
    actor.role = null;
    expect((await call()).status).toBe(403);
  });

  it("rejects non-admin callers", async () => {
    actor.role = "FINANCE";
    expect((await call()).status).toBe(403);
  });

  it("returns the community default for an admin", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tier: "community",
      licensee: "community",
      expiresAt: "",
      status: "none",
    });
  });

  it("returns an injected valid licence without the token", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const h = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(
      JSON.stringify({ tier: "business", licensee: "Acme", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    const token = `${h}.${p}.${sign(null, Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
    process.env.HEXPROCURE_LICENSE = token;
    resetLicenseCache(publicKey.export({ type: "spki", format: "pem" }).toString());

    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toEqual({ tier: "business", licensee: "Acme", expiresAt: expect.any(String), status: "active" });
  });
});
