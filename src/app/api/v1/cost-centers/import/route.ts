import { csvImportRoute } from "@/lib/api/master-data-routes";
import { importCostCenters, MAX_IMPORT_BYTES } from "@/lib/services/master-data/csv-import";

export const POST = csvImportRoute(importCostCenters, MAX_IMPORT_BYTES);
