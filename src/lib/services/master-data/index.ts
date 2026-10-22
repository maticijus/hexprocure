import type { MasterDataResource } from "@/lib/api/master-data-routes";
import * as approvalRules from "./approval-rules";
import * as budgets from "./budgets";
import * as costCenters from "./cost-centers";
import * as suppliers from "./suppliers";

export const supplierResource: MasterDataResource<suppliers.Supplier, suppliers.SupplierInput> = {
  listKey: "suppliers",
  label: "Supplier",
  editRoles: ["ADMIN", "FINANCE"],
  list: suppliers.listSuppliers,
  get: suppliers.getSupplier,
  parseCreate: (body) => suppliers.parseSupplierInput(body) as suppliers.SupplierInput,
  parsePatch: (body) => suppliers.parseSupplierInput(body, true),
  create: suppliers.createSupplier,
  update: suppliers.updateSupplier,
  archive: suppliers.archiveSupplier,
};

export const costCenterResource: MasterDataResource<costCenters.CostCenter, costCenters.CostCenterInput> = {
  listKey: "costCenters",
  label: "Cost center",
  editRoles: ["ADMIN"],
  list: costCenters.listCostCenters,
  get: costCenters.getCostCenter,
  parseCreate: (body) => costCenters.parseCostCenterInput(body) as costCenters.CostCenterInput,
  parsePatch: (body) => costCenters.parseCostCenterInput(body, true),
  create: costCenters.createCostCenter,
  update: costCenters.updateCostCenter,
  archive: costCenters.archiveCostCenter,
};

export const budgetResource: MasterDataResource<budgets.Budget, budgets.BudgetInput> = {
  listKey: "budgets",
  label: "Budget",
  editRoles: ["ADMIN", "FINANCE"],
  list: budgets.listBudgets,
  get: budgets.getBudget,
  parseCreate: budgets.parseBudgetInput,
  parsePatch: budgets.parseBudgetPatch,
  create: budgets.createBudget,
  update: budgets.updateBudget,
  archive: budgets.archiveBudget,
};

export const approvalRuleResource: MasterDataResource<
  approvalRules.ApprovalRuleRow,
  approvalRules.ApprovalRuleInput
> = {
  listKey: "approvalRules",
  label: "Approval rule",
  editRoles: ["ADMIN"],
  list: approvalRules.listApprovalRules,
  get: approvalRules.getApprovalRule,
  parseCreate: (body) => approvalRules.parseApprovalRuleInput(body) as approvalRules.ApprovalRuleInput,
  parsePatch: (body) => approvalRules.parseApprovalRuleInput(body, true),
  create: approvalRules.createApprovalRule,
  update: approvalRules.updateApprovalRule,
  archive: approvalRules.archiveApprovalRule,
};
