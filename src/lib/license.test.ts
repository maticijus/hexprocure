import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createPublicKey } from "node:crypto";
import {
  getLicense,
  getLicenseStatus,
  hasTier,
  LICENSOR_PUBLIC_KEY,
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
      ...claims,
    }),
  );
  const sig = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

const COMMUNITY = { tier: "community", licensee: "community", expiresAt: "" };

afterEach(() => {
  delete process.env.HEXPROCURE_LICENSE;
  delete process.env.HEXPROCURE_LICENSE_PUBLIC_KEY;
  resetLicenseCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("parseLicense", () => {
  it("accepts a valid token", () => {
    const k = newKeys();
    const lic = parseLicense(mint(k.privateKey), k.publicPem);
    expect(lic).toEqual({ tier: "team", licensee: "Acme GmbH", expiresAt: expect.any(String) });
    expect(new Date(lic!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("ignores unknown claims such as the old limit fields", () => {
    const k = newKeys();
    const lic = parseLicense(mint(k.privateKey, { aiDocsPerMonth: 500, connectors: ["qbo"] }), k.publicPem);
    expect(lic).toEqual({ tier: "team", licensee: "Acme GmbH", expiresAt: expect.any(String) });
  });

  it("rejects a signature of the wrong length", () => {
    const k = newKeys();
    const [h, p, s] = mint(k.privateKey).split(".");
    expect(parseLicense(`${h}.${p}.${s}AAAA`, k.publicPem)).toBeNull();
    expect(parseLicense(`${h}.${p}.${s.slice(0, 40)}`, k.publicPem)).toBeNull();
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
    const forged = b64(JSON.stringify({ tier: "business", licensee: "x", exp: 9_999_999_999 }));
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
  });

  it.each(["", "abc", "a.b", "a.b.c.d", "...", "!!!.@@@.###"])("returns null for malformed token %j", (t) => {
    const k = newKeys();
    expect(parseLicense(t, k.publicPem)).toBeNull();
  });

  it("rejects Object.prototype keys as tier", () => {
    const k = newKeys();
    for (const tier of ["toString", "valueOf", "constructor"]) {
      expect(parseLicense(mint(k.privateKey, { tier }), k.publicPem)).toBeNull();
    }
  });

  it("rejects an Ed448 public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed448");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(parseLicense(mint(privateKey), pem)).toBeNull();
  });

  it("returns null for a garbage public key without throwing", () => {
    const k = newKeys();
    expect(parseLicense(mint(k.privateKey), "not a pem")).toBeNull();
  });
});

describe("getLicense", () => {
  it("defaults to community when env is missing", () => {
    expect(getLicense()).toEqual(COMMUNITY);
    expect(getLicenseStatus()).toBe("none");
  });

  it("ships a pinned Ed25519 Licensor public key", () => {
    expect(createPublicKey(LICENSOR_PUBLIC_KEY).asymmetricKeyType).toBe("ed25519");
  });

  it("ignores HEXPROCURE_LICENSE_PUBLIC_KEY outside the test environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    const k = newKeys();
    process.env.HEXPROCURE_LICENSE = mint(k.privateKey);
    process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getLicense()).toEqual(COMMUNITY);
    expect(getLicenseStatus()).toBe("invalid");
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
    expect(getLicenseStatus()).toBe("active");
    delete process.env.HEXPROCURE_LICENSE;
    expect(getLicense()).toBe(first);
  });

  it("falls back to community and warns once when a cached licence expires", () => {
    vi.useFakeTimers();
    try {
      const k = newKeys();
      process.env.HEXPROCURE_LICENSE = mint(k.privateKey);
      process.env.HEXPROCURE_LICENSE_PUBLIC_KEY = k.publicPem;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getLicense().tier).toBe("team");
      vi.setSystemTime(Date.now() + 2 * 3600_000);
      expect(getLicense()).toEqual(COMMUNITY);
      expect(getLicenseStatus()).toBe("expired");
      getLicense();
      expect(warn).toHaveBeenCalledTimes(1);
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
    expect(getLicenseStatus()).toBe("invalid");
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
