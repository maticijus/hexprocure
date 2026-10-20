import { createPublicKey, verify } from "node:crypto";
import { DomainError } from "@/lib/services/p2p";

export type Tier = "community" | "team" | "business";

export type License = {
  tier: Tier;
  licensee: string;
  expiresAt: string;
  aiDocsPerMonth: number;
  connectors: string[];
};

const TIER_RANK: Record<Tier, number> = { community: 0, team: 1, business: 2 };

const COMMUNITY: License = {
  tier: "community",
  licensee: "community",
  expiresAt: "",
  aiDocsPerMonth: 0,
  connectors: [],
};

const decodeJson = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

function toLicense(claims: unknown, now: Date): License | null {
  if (typeof claims !== "object" || claims === null) return null;
  const c = claims as Record<string, unknown>;
  const { tier, licensee, exp, aiDocsPerMonth, connectors } = c;
  if (typeof tier !== "string" || !Object.hasOwn(TIER_RANK, tier)) return null;
  if (typeof licensee !== "string" || licensee === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= now.getTime()) return null;
  if (typeof aiDocsPerMonth !== "number" || !Number.isInteger(aiDocsPerMonth) || aiDocsPerMonth < 0) return null;
  if (!Array.isArray(connectors) || !connectors.every((x) => typeof x === "string")) return null;
  return {
    tier: tier as Tier,
    licensee,
    expiresAt: new Date(exp * 1000).toISOString(),
    aiDocsPerMonth,
    connectors,
  };
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
    if (!verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) return null;
    return toLicense(decodeJson(p), now);
  } catch {
    return null;
  }
}

let cached: License | null = null;
let expiredWarned = false;

export function resetLicenseCache(): void {
  cached = null;
  expiredWarned = false;
}

export function getLicense(): License {
  if (!cached) {
    const token = process.env.HEXPROCURE_LICENSE?.trim();
    const pem = process.env.HEXPROCURE_LICENSE_PUBLIC_KEY?.replace(/\\n/g, "\n");
    const parsed = token && pem ? parseLicense(token, pem) : null;
    if (token && !parsed) {
      console.warn("HEXPROCURE_LICENSE is set but invalid or expired; running as Community");
    }
    cached = parsed ?? COMMUNITY;
  }
  // The parsed token is cached, but expiry is re-checked on every call.
  if (cached !== COMMUNITY && new Date(cached.expiresAt).getTime() <= Date.now()) {
    if (!expiredWarned) {
      expiredWarned = true;
      console.warn("HEXPROCURE_LICENSE has expired; running as Community");
    }
    return COMMUNITY;
  }
  return cached;
}

export function hasTier(license: License, required: Tier): boolean {
  return TIER_RANK[license.tier] >= TIER_RANK[required];
}

export function requireTier(required: Tier): void {
  if (!hasTier(getLicense(), required)) {
    throw new DomainError("LICENSE_REQUIRED", `Requires a ${required} licence`);
  }
}
