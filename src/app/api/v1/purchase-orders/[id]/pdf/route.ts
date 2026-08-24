import { buildPurchaseOrderPdf } from "@/lib/services/po-document";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getActor(request);
    const { id } = await params;
    const url = new URL(request.url);
    const forSupplier = url.searchParams.get("variant") === "supplier";
    const pdf = await buildPurchaseOrderPdf(id, forSupplier);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="PO-${id.slice(0, 8)}.pdf"`,
      },
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
