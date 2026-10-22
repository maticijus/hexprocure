import { archiveRoute } from "@/lib/api/master-data-routes";
import { approvalRuleResource } from "@/lib/services/master-data";

export const POST = archiveRoute(approvalRuleResource);
