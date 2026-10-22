import { archiveRoute } from "@/lib/api/master-data-routes";
import { supplierResource } from "@/lib/services/master-data";

export const POST = archiveRoute(supplierResource);
