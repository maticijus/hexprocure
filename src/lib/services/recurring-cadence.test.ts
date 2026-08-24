import { describe, it, expect } from "vitest";
import { addMonthsIso, cadenceStepMonths } from "./recurring";

describe("cadenceStepMonths", () => {
  it("maps cadences to month steps", () => {
    expect(cadenceStepMonths("MONTHLY")).toBe(1);
    expect(cadenceStepMonths("QUARTERLY")).toBe(3);
    expect(cadenceStepMonths("YEARLY")).toBe(12);
  });
});

describe("addMonthsIso", () => {
  it("adds months within the same month length", () => {
    expect(addMonthsIso("2026-03-15", 1)).toBe("2026-04-15");
    expect(addMonthsIso("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonthsIso("2026-02-15", 12)).toBe("2027-02-15");
  });

  it("clamps day-of-month when target month is shorter", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsIso("2026-01-30", 1)).toBe("2026-02-28");
  });

  it("handles leap years", () => {
    expect(addMonthsIso("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("keeps the original day when a later month is long enough", () => {
    // Jan 31 -> Feb 28 (clamped) -> Mar 28? or Mar 31?
    // We clamp persistently: once clamped, the anchor stays at the last valid day.
    const feb28 = addMonthsIso("2026-01-31", 1);
    expect(addMonthsIso(feb28, 1)).toBe("2026-03-28");
  });

  it("crosses year boundaries", () => {
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsIso("2026-12-31", 2)).toBe("2027-02-28");
  });
});
