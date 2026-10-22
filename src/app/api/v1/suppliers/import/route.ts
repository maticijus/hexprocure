import { csvImportRoute } from "@/lib/api/master-data-routes";
import { importSuppliers, MAX_IMPORT_BYTES } from "@/lib/services/master-data/csv-import";

export const POST = csvImportRoute(importSuppliers, MAX_IMPORT_BYTES);
