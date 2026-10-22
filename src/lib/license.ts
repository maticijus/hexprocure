import { createPublicKey, verify } from "node:crypto";
import { DomainError } from "@/lib/services/p2p";

export type Tier = "community" | "team" | "business";

export type License = {
  tier: Tier;
  licensee: string;
  expiresAt: string;
};

export type LicenseStatus = "none" | "invalid" | "expired" | "active";

// Ed25519 public key of HEXENKRAFT s.r.o., the Licensor named in ee/LICENSE.
// Keys are signed with scripts/license-sign.ts. Swapping this key defeats the
// Licence Check (ee/LICENSE section 5). Tests may override it through
// HEXPROCURE_LICENSE_PUBLIC_KEY; production ignores that variable.
export const LICENSOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8FYCLiNhAINGTQhgvb+QYaZNQf6REoH5lbO9ahSQrOg=
-----END PUBLIC KEY-----
`;

const TIER_RANK: Record<Tier, number> = { community: 0, team: 1, business: 2 };

const COMMUNITY: License = { tier: "community", licensee: "community", expiresAt: "" };

const decodeJson = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

function toLicense(claims: unknown, now: Date): License | null {
  if (typeof claims !== "object" || claims === null) return null;
  const { tier, licensee, exp } = claims as Record<string, unknown>;
  if (typeof tier !== "string" || !Object.hasOwn(TIER_RANK, tier)) return null;
  if (typeof licensee !== "string" || licensee === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= now.getTime()) return null;
  return { tier: tier as Tier, licensee, expiresAt: new Date(exp * 1000).toISOString() };
}

export function parseLicense(token: string, publicKeyPem: string, now: Date = new Date()): License | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = decodeJson(h) as { alg?: unknown };
    if (header.alg !== "EdDSA") return null;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    const signature = Buffer.from(s, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== s) return null;
    if (!verify(null, Buffer.from(`${h}.${p}`), key, signature)) return null;
    return toLicense(decodeJson(p), now);
  } catch {
    return null;
  }
}

function verifyingKey(): string {
  const override = process.env.NODE_ENV === "test" ? process.env.HEXPROCURE_LICENSE_PUBLIC_KEY : undefined;
  return override ? override.replace(/\\n/g, "\n") : LICENSOR_PUBLIC_KEY;
}

let cached: License | null = null;
let status: LicenseStatus = "none";
let expiredWarned = false;

export function resetLicenseCache(): void {
  cached = null;
  status = "none";
  expiredWarned = false;
}

export function getLicense(): License {
  if (!cached) {
    const token = process.env.HEXPROCURE_LICENSE?.trim();
    const parsed = token ? parseLicense(token, verifyingKey()) : null;
    if (token && !parsed) {
      console.warn("HEXPROCURE_LICENSE is set but invalid or expired; running as Community");
    }
    cached = parsed ?? COMMUNITY;
    status = parsed ? "active" : token ? "invalid" : "none";
  }
  // The parsed token is cached, but expiry is re-checked on every call.
  if (cached !== COMMUNITY && new Date(cached.expiresAt).getTime() <= Date.now()) {
    status = "expired";
    if (!expiredWarned) {
      expiredWarned = true;
      console.warn("HEXPROCURE_LICENSE has expired; running as Community");
    }
    return COMMUNITY;
  }
  return cached;
}

export function getLicenseStatus(): LicenseStatus {
  getLicense();
  return status;
}

export function hasTier(license: License, required: Tier): boolean {
  return TIER_RANK[license.tier] >= TIER_RANK[required];
}

export function requireTier(required: Tier): void {
  if (!hasTier(getLicense(), required)) {
    throw new DomainError("LICENSE_REQUIRED", `Requires a ${required} licence`);
  }
}
