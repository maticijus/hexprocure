const QBO_LABELS: Record<string, string> = {
  NEVER_CONNECTED: "Never connected",
  NOT_CONFIGURED: "Not configured",
  ACTIVE: "Connected",
  EXPIRED: "Needs reconnect",
  ERROR: "Needs reconnect",
  REVOKED: "Disconnected",
};

export function qboStatusLabel(status: string): string {
  const known = QBO_LABELS[status];
  if (known) return known;
  const words = status.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function sumLinesMinor(lines: { quantity: number; unitPriceMinor: number }[]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPriceMinor, 0);
}
