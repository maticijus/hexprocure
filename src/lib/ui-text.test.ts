import { describe, expect, it } from "vitest";
import { qboStatusLabel, sumLinesMinor } from "./ui-text";

describe("qboStatusLabel", () => {
  it.each([
    ["NEVER_CONNECTED", "Never connected"],
    ["ACTIVE", "Connected"],
    ["EXPIRED", "Needs reconnect"],
    ["ERROR", "Needs reconnect"],
    ["REVOKED", "Disconnected"],
    ["NOT_CONFIGURED", "Not configured"],
  ])("maps %s to %s", (raw, label) => {
    expect(qboStatusLabel(raw)).toBe(label);
  });

  it("never leaks an unknown enum as raw upper-case text", () => {
    expect(qboStatusLabel("SOMETHING_NEW")).toBe("Something new");
  });
});

describe("sumLinesMinor", () => {
  it("sums quantity times unit price in integer minor units", () => {
    expect(sumLinesMinor([{ quantity: 2, unitPriceMinor: 15_000 }, { quantity: 3, unitPriceMinor: 199 }])).toBe(30_597);
  });

  it("is zero for no lines", () => {
    expect(sumLinesMinor([])).toBe(0);
  });
});
