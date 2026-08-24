import { NextResponse } from "next/server";
import { PaddleOcrProvider } from "@/lib/integrations/ocr-provider";
import { parseInvoiceText } from "@/lib/integrations/invoice-parser";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await getActor(request);
    const ocrUrl = process.env.INTEGRATION_OCR_URL;
    if (!ocrUrl) {
      return NextResponse.json(
        { error: { code: "NOT_CONFIGURED", message: "Set INTEGRATION_OCR_URL to enable OCR intake" } },
        { status: 501 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "multipart field 'file' is required" } },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const ocr = new PaddleOcrProvider(ocrUrl).extract;
    const result = await ocr(buffer, file.name);
    const draft = parseInvoiceText(result.text);
    return NextResponse.json({ draft, rawText: result.text.slice(0, 5000) });
  } catch (error) {
    return errorToResponse(error);
  }
}
