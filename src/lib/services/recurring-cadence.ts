export type Cadence = "MONTHLY" | "QUARTERLY" | "YEARLY";

export function cadenceStepMonths(cadence: Cadence): number {
  switch (cadence) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "YEARLY":
      return 12;
  }
}

/** Adds months to a YYYY-MM-DD date, clamping the day when the target month
 *  is shorter (2026-01-31 +1M -> 2026-02-28; then continues from the clamped day). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;

  const lastDayOfTarget = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDayOfTarget);

  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
