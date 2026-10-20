import { hasTier, type License, type Tier } from "@/lib/license";

export const FEATURES = {
  "ai-triage": "team",
  "ai-duplicates": "team",
  "ai-drafting": "business",
  "ai-categorisation": "business",
  "ai-anomaly": "business",
  "supplier-screening-full": "business",
  "connectors-team-pack": "team",
  "connectors-business-pack": "business",
  "mcp-write-tools": "team",
  sso: "business",
  "multi-currency": "team",
} as const satisfies Record<string, Tier>;

export type FeatureId = keyof typeof FEATURES;

export const featureTier = (id: FeatureId): Tier => FEATURES[id];

export const isFeatureEnabled = (id: FeatureId, license: License): boolean => hasTier(license, FEATURES[id]);
