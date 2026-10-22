import { collectionRoutes } from "@/lib/api/master-data-routes";
import { costCenterResource } from "@/lib/services/master-data";

export const { GET, POST } = collectionRoutes(costCenterResource);
