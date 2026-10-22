import { itemRoutes } from "@/lib/api/master-data-routes";
import { supplierResource } from "@/lib/services/master-data";

export const { GET, PATCH } = itemRoutes(supplierResource);
