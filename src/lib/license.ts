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
// Licence Check (ee/LICENSE section 5). The verifying key is never read from
// the environment; tests inject one through resetLicenseCache(pem).
export const LICENSOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcPHUzqq3BFEjQRM3l8DpMZYIBkm7Gj9udFmV606QVlw=
-----END PUBLIC KEY-----
`;

const TIER_RANK: Record<Tier, number> = { community: 0, team: 1, business: 2 };

const COMMUNITY: License = { tier: "community", licensee: "community", expiresAt: "" };

const decodeJson = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

function toLicense(claims: unknown): License | null {
  if (typeof claims !== "object" || claims === null) return null;
  const { tier, licensee, exp } = claims as Record<string, unknown>;
  if (typeof tier !== "string" || !Object.hasOwn(TIER_RANK, tier)) return null;
  if (typeof licensee !== "string" || licensee === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { tier: tier as Tier, licensee, expiresAt: new Date(exp * 1000).toISOString() };
}

const isExpired = (license: License, now: Date): boolean => new Date(license.expiresAt).getTime() <= now.getTime();

/** Signature and claim shape only; the caller decides what an expired licence means. */
function verifyToken(token: string, publicKeyPem: string): License | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = decodeJson(h) as { alg?: unknown };
    if (header.alg !== "EdDSA") return null;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    // RFC 7515: unpadded base64url only, and exactly one encoding per signature.
    const signature = Buffer.from(s, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== s) return null;
    if (!verify(null, Buffer.from(`${h}.${p}`), key, signature)) return null;
    return toLicense(decodeJson(p));
  } catch {
    return null;
  }
}

export function parseLicense(token: string, publicKeyPem: string, now: Date = new Date()): License | null {
  const license = verifyToken(token, publicKeyPem);
  return license && !isExpired(license, now) ? license : null;
}

let verifyingPem = LICENSOR_PUBLIC_KEY;
let cached: License | null = null;
let cachedStatus: LicenseStatus = "none";
let expiredWarned = false;

/** Clears the cached licence. Tests pass their own public key; production always uses the pinned one. */
export function resetLicenseCache(publicKeyPem: string = LICENSOR_PUBLIC_KEY): void {
  verifyingPem = publicKeyPem;
  cached = null;
  cachedStatus = "none";
  expiredWarned = false;
}

export function getLicenseState(): { license: License; status: LicenseStatus } {
  if (!cached) {
    const token = process.env.HEXPROCURE_LICENSE?.trim();
    const verified = token ? verifyToken(token, verifyingPem) : null;
    if (token && !verified) {
      console.warn("HEXPROCURE_LICENSE is set but invalid; running as Community");
    }
    cached = verified ?? COMMUNITY;
    cachedStatus = verified ? "active" : token ? "invalid" : "none";
  }
  // The verified token is cached, but expiry is re-checked on every call.
  if (cached !== COMMUNITY && isExpired(cached, new Date())) {
    if (!expiredWarned) {
      expiredWarned = true;
      console.warn("HEXPROCURE_LICENSE has expired; running as Community");
    }
    return { license: COMMUNITY, status: "expired" };
  }
  return { license: cached, status: cachedStatus };
}

export const getLicense = (): License => getLicenseState().license;

export const getLicenseStatus = (): LicenseStatus => getLicenseState().status;

export function hasTier(license: License, required: Tier): boolean {
  return TIER_RANK[license.tier] >= TIER_RANK[required];
}

export function requireTier(required: Tier): void {
  if (!hasTier(getLicense(), required)) {
    throw new DomainError("LICENSE_REQUIRED", `Requires a ${required} licence`);
  }
}
