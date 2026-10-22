import { itemRoutes } from "@/lib/api/master-data-routes";
import { budgetResource } from "@/lib/services/master-data";

export const { GET, PATCH } = itemRoutes(budgetResource);
