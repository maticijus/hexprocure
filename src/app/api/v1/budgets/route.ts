import { collectionRoutes } from "@/lib/api/master-data-routes";
import { budgetResource } from "@/lib/services/master-data";

export const { GET, POST } = collectionRoutes(budgetResource);
