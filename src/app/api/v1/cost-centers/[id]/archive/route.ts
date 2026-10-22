import { archiveRoute } from "@/lib/api/master-data-routes";
import { costCenterResource } from "@/lib/services/master-data";

export const POST = archiveRoute(costCenterResource);
