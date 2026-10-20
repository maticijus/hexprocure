import { describe, expect, it } from "vitest";
import { FEATURES, featureTier, isFeatureEnabled } from "./features";
import type { License, Tier } from "@/lib/license";

const lic = (tier: Tier): License => ({ tier, licensee: "t", expiresAt: "", aiDocsPerMonth: 0, connectors: [] });

describe("ee features", () => {
  it("maps every feature to its minimum tier", () => {
    expect(FEATURES).toEqual({
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
    });
  });

  it("featureTier returns the minimum tier", () => {
    expect(featureTier("ai-triage")).toBe("team");
    expect(featureTier("sso")).toBe("business");
  });

  it("isFeatureEnabled follows tier ordering", () => {
    expect(isFeatureEnabled("ai-triage", lic("community"))).toBe(false);
    expect(isFeatureEnabled("ai-triage", lic("team"))).toBe(true);
    expect(isFeatureEnabled("sso", lic("team"))).toBe(false);
    expect(isFeatureEnabled("sso", lic("business"))).toBe(true);
    expect(isFeatureEnabled("ai-triage", lic("business"))).toBe(true);
  });
});
