export interface InvoiceDraft {
  invoiceNumber: string | null;
  issueDate: string | null;
  totalMinor: number | null;
  vatId: string | null;
  currency: string;
  confidence: "HIGH" | "LOW";
}

const INVOICE_NUMBER_RE =
  /\b(?:invoice|rechnung|ref\.?|number|nr\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-/]{3,})\b/i;
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const EU_DATE_RE = /\b(\d{2})\.(\d{2})\.(\d{4})\b/;
const VAT_RE = /\b([A-Z]{2}[A-Z0-9]{8,12})\b/;
const LABELED_TOTAL_RES = [
  /(?:grand\s+total|total\s+amount|amount\s+due|gesamtbetrag|gesamt)\s*[:]?\s*(?:EUR|USD|GBP)?\s*([\d.,]+)/i,
  /\btota?l\b\s*[:]?\s*(?:EUR|USD|GBP)?\s*([\d.,]+)/i,
];

function parseAmount(raw: string): number | null {
  const s = raw.trim();
  const commaLast = /\d,\d{2}$/.test(s);
  let cleaned: string;
  if (commaLast) {
    cleaned = s.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

function findTotal(text: string): number | null {
  for (const re of LABELED_TOTAL_RES) {
    const m = text.match(re);
    if (m) {
      const minor = parseAmount(m[1]);
      if (minor !== null) return minor;
    }
  }
  return null;
}

export function parseInvoiceText(text: string): InvoiceDraft {
  const numberMatch = text.match(INVOICE_NUMBER_RE);
  const invoiceNumber = numberMatch ? numberMatch[1].trim() : null;

  let issueDate: string | null = null;
  const iso = text.match(ISO_DATE_RE);
  if (iso) {
    issueDate = iso[1];
  } else {
    const eu = text.match(EU_DATE_RE);
    if (eu) issueDate = `${eu[3]}-${eu[2]}-${eu[1]}`;
  }

  const totalMinor = findTotal(text);

  const vatMatch = text.match(VAT_RE);
  const vatId = vatMatch ? vatMatch[1] : null;

  const found = [invoiceNumber, issueDate, totalMinor].filter(Boolean).length;
  const confidence = found >= 2 && totalMinor !== null ? "HIGH" : "LOW";

  return { invoiceNumber, issueDate, totalMinor, vatId, currency: "EUR", confidence };
}
