import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  getLicense,
  hasTier,
  parseLicense,
  requireTier,
  resetLicenseCache,
  type Tier,
} from "@/lib/license";
import { DomainError } from "@/lib/services/p2p";

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");

function newKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

function mint(privateKey: KeyObject, claims: Record<string, unknown> = {}) {
  const header = b64(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({
      tier: "team",
      licensee: "Acme GmbH",
      exp: Math.floor(Date.now() / 1000) + 3600,
      aiDocsPerMonth: 500,
      connectors: ["qbo", "xero"],
      ...claims,
    }),
  );
  const sig = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

const COMMUNITY = { tier: "community", licensee: "community", expiresAt: "", aiDocsPerMonth: 0, connectors: [] };

afterEach(() => {
  delete process.env.HEXPROCURE_LICENSE;
  delete process.env.HEXPROCURE_LICENSE_PUBLIC_KEY;
  resetLicenseCache();
  vi.restoreAllMocks();
});

describe("parseLicense", () => {
  it("accepts a valid token", () => {
    const k = newKeys();
    const lic = parseLicense(mint(k.privateKey), k.publicPem);
    expect(lic).toMatchObject({ tier: "team", licensee: "Acme GmbH", aiDocsPerMonth: 500, connectors: ["qbo", "xero"] });
    expect(new Date(lic!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects an expired token", () => {
    const k = newKeys();
    const token = mint(k.privateKey, { exp: Math.floor(Date.now() / 1000) - 10 });
    expect(parseLicense(token, k.publicPem)).toBeNull();
  });

  it("honours the injected clock", () => {
    const k = newKeys();
    const token = mint(k.privateKey);
    expect(parseLicense(token, k.publicPem, new Date(Date.now() + 2 * 3600_000))).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const k = newKeys();
    const [h, , s] = mint(k.privateKey).split(".");
    const forged = b64(JSON.stringify({ tier: "business", licensee: "x", exp: 9_999_999_999, aiDocsPerMonth: 1, connectors: [] }));
    expect(parseLicense(`${h}.${forged}.${s}`, k.publicPem)).toBeNull();
  });

  it("rejects a token signed by another key", () => {
    const signer = newKeys();
    const other = newKeys();
    expect(parseLicense(mint(signer.privateKey), other.publicPem)).toBeNull();
  });

  it("rejects a wrong alg header", () => {
    const k = newKeys();
    const [, p, s] = mint(k.privateKey).split(".");
    const header = b64(JSON.stringify({ alg: "none", typ: "JWT" }));
    expect(parseLicense(`${header}.${p}.${s}`, k.publicPem)).toBeNull();
  });

  it("rejects missing or invalid required fields", () => {
    const k = newKeys();
    expect(parseLicense(mint(k.privateKey, { tier: "gold" }), k.publicPem)).toBeNull();
    expect(parseLicense(mint(k.privateKey, { licensee: undefined }), k.publicPem)).toBeNull();
    expect(parseLicense(mint(k.privateKey, { exp: undefined }), k.publicPem)).toBeNull();
    expect(parseLicense(mint(k.privateKey, { connectors: "qbo" }), k.publicPem)).toBeNull();
    expect(parseLicense(mint(k.privateKey, { aiDocsPerMonth: -1 }), k.publicPem)).toBeNull();
  });

  it.each(["", "abc", "a.b", "a.b.c.d", "...", "!!!.@@@.###"])("returns null for malformed token %j", (t) => {
    const k = newKeys();
    expect(parseLicense(t, k.publicPem)).toBeNull();
  });

  it("rejects tier names that are only Object.prototype properties", () => {
    const k = newKeys();
    for (const tier of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(parseLicense(mint(k.privateKey, { tier }), k.publicPem)).toBeNull();
    }
  });

  it("rejects a public key that is not Ed25519", () => {
    const k = newKeys();
    const other = generateKeyPairSync("ed448");
    const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(parseLicense(mint(k.privateKey), otherPem)).toBeNull();
  });

  it("returns null for a garbage public key without throwing", () => {
    const k = newKeys();
    expect(parseLicense(mint(k.privateKey), "not a pem")).toBeNull();
  });
});

describe("getLicense", () => {
  it("defaults to community when env is missing", () => {
    expect(getLicense()).toEqual(COMMUNITY);
  });

  it("defaults to community when only the token is set", () => {
    const k = newKeys();
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey);
    expect(getLicense()).toEqual(COMMUNITY);
  });

  it("returns the licence for a valid token and memoises it", () => {
    const k = newKeys();
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey);
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
    const first = getLicense();
    expect(first.tier).toBe("team");
    delete process.env.HEXPROCURE_LICENSE;
    expect(getLicense()).toBe(first);
  });

  it("drops back to community once the memoised licence expires", () => {
    const k = newKeys();
    const exp = Math.floor(Date.now() / 1000) + 2;
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey, { exp });
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getLicense().tier).toBe("team");
    vi.useFakeTimers({ now: exp * 1000 + 1000, toFake: ["Date"] });
    try {
      expect(getLicense()).toEqual(COMMUNITY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a PEM with escaped newlines", () => {
    const k = newKeys();
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey);
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem.replace(/\n/g, "\\n");
    expect(getLicense().tier).toBe("team");
  });

  it("warns once without leaking the token when the token is invalid", () => {
    const k = newKeys();
    const token = mint(k.privateKey, { tier: "gold" });
    process.env.HEXPROCURE_LICENSE = token;
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getLicense()).toEqual(COMMUNITY);
    getLicense();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });

  it("does not warn when no token is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getLicense();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("hasTier", () => {
  const lic = (tier: Tier) => ({ ...COMMUNITY, tier });
  it("orders community < team < business", () => {
    expect(hasTier(lic("community"), "community")).toBe(true);
    expect(hasTier(lic("community"), "team")).toBe(false);
    expect(hasTier(lic("team"), "community")).toBe(true);
    expect(hasTier(lic("team"), "team")).toBe(true);
    expect(hasTier(lic("team"), "business")).toBe(false);
    expect(hasTier(lic("business"), "team")).toBe(true);
    expect(hasTier(lic("business"), "business")).toBe(true);
  });
});

describe("requireTier", () => {
  it("throws LICENSE_REQUIRED on the community default", () => {
    try {
      requireTier("team");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("LICENSE_REQUIRED");
    }
  });

  it("passes when the licence is high enough", () => {
    const k = newKeys();
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey, { tier: "business" });
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
    expect(() => requireTier("team")).not.toThrow();
    expect(() => requireTier("business")).not.toThrow();
  });
});
