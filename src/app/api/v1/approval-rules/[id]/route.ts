import { itemRoutes } from "@/lib/api/master-data-routes";
import { approvalRuleResource } from "@/lib/services/master-data";

export const { GET, PATCH } = itemRoutes(approvalRuleResource);
