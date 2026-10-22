import { archiveRoute } from "@/lib/api/master-data-routes";
import { budgetResource } from "@/lib/services/master-data";

export const POST = archiveRoute(budgetResource);
