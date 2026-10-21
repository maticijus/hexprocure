export const MAX_INVOICE_FILE_BYTES = 10 * 1024 * 1024;
export const INVOICE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export function invoiceFileProblem(file: { size: number; type: string }): string | null {
  if (!INVOICE_FILE_TYPES.includes(file.type)) return "Invoice file must be a PDF, PNG or JPEG";
  if (file.size > MAX_INVOICE_FILE_BYTES) return "Invoice file must be 10 MB or smaller";
  return null;
}
