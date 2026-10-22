import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { approvals, auditEvents } from "@/lib/db/schema";
import { createRequisitionWithLine, seedOrg, truncateAll } from "@/lib/testing/seed";
import { submitRequisition } from "@/lib/services/p2p";
import { startSession } from "@/lib/services/sessions";
import { GET as options } from "@/app/api/v1/meta/options/route";
import { POST as createRequisition } from "@/app/api/v1/requisitions/route";
import { BodyReader } from "@/lib/api/validate";
import {
  archiveSupplier,
  createSupplier,
  parseSupplierInput,
  updateSupplier,
} from "./suppliers";
import { archiveCostCenter, createCostCenter, updateCostCenter } from "./cost-centers";
import { archiveBudget, createBudget, parseBudgetInput, updateBudget } from "./budgets";
import {
  archiveApprovalRule,
  createApprovalRule,
  parseApprovalRuleInput,
  updateApprovalRule,
} from "./approval-rules";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("BodyReader", () => {
  it("collects every problem into one VALIDATION error", () => {
    const reader = new BodyReader({ name: " ", currency: "XYZ", yearMonth: "2026-13", n: -1, id: "x" });
    reader.string("name");
    reader.currency("currency");
    reader.yearMonth("yearMonth");
    reader.nonNegativeInt("n");
    reader.uuid("id");
    reader.email("missing");
    expect(reader.errors).toHaveLength(5);
    expect(() => reader.done()).toThrow(/name is required; currency must be one of/);
  });

  it("skips absent keys in partial mode and rejects non-objects", () => {
    const reader = new BodyReader({}, true);
    expect(reader.string("name")).toBeUndefined();
    expect(reader.errors).toEqual([]);
    expect(() => new BodyReader([1])).toThrow(/JSON object/);
    expect(new BodyReader({ name: "x".repeat(201) }).string("name")).toBeUndefined();
  });
});

describe("suppliers", () => {
  it("creates, rejects a duplicate active name, edits and archives", async () => {
    const { finance } = await seedOrg();
    const s = await createSupplier({ name: "Beta Ltd", email: "a@beta.test" }, finance.id);
    await expect(createSupplier({ name: "beta ltd", email: null }, finance.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const edited = await updateSupplier(s.id, { email: null }, finance.id);
    expect(edited.email).toBeNull();
    const archived = await archiveSupplier(s.id, finance.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(updateSupplier(s.id, { name: "X" }, finance.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await createSupplier({ name: "Beta Ltd", email: null }, finance.id)).id).not.toBe(s.id);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, s.id));
    expect(events.map((e) => e.action).sort()).toEqual(["ARCHIVED", "CREATED", "UPDATED"]);
  });

  it("validates name and email", () => {
    expect(() => parseSupplierInput({ email: "nope" })).toThrow(/name is required; email must be a valid email/);
    expect(parseSupplierInput({ name: " Acme ", email: "" })).toEqual({ name: "Acme", email: null });
    expect(parseSupplierInput({ email: "X@Y.test" }, true)).toEqual({ email: "x@y.test" });
  });
});

describe("cost centers", () => {
  it("creates, renames, rejects duplicates and archives", async () => {
    const { finance } = await seedOrg();
    const cc = await createCostCenter({ name: "Ops" }, finance.id);
    await expect(updateCostCenter(cc.id, { name: "it" }, finance.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await updateCostCenter(cc.id, { name: "Operations" }, finance.id)).name).toBe("Operations");
    expect((await archiveCostCenter(cc.id, finance.id)).archivedAt).toBeInstanceOf(Date);
  });
});

describe("budgets", () => {
  it("enforces one budget per cost center and month, restores an archived one", async () => {
    const { finance, cc, yearMonth, budget } = await seedOrg();
    const input = { costCenterId: cc.id, yearMonth, budgetedMinor: 5_000, currency: "EUR" };
    await expect(createBudget(input, finance.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await updateBudget(budget.id, { budgetedMinor: 7_000 }, finance.id)).budgetedMinor).toBe(7_000);
    await archiveBudget(budget.id, finance.id);
    const restored = await createBudget(input, finance.id);
    expect(restored).toMatchObject({ id: budget.id, budgetedMinor: 5_000, archivedAt: null });
  });

  it("rejects an archived cost center and malformed input", async () => {
    const { finance, cc } = await seedOrg();
    await archiveCostCenter(cc.id, finance.id);
    await expect(
      createBudget({ costCenterId: cc.id, yearMonth: "2027-01", budgetedMinor: 1, currency: "EUR" }, finance.id),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => parseBudgetInput({ costCenterId: cc.id, yearMonth: "2027-1", budgetedMinor: 1.5, currency: "eur" }))
      .toThrow(/yearMonth must look like 2026-01; budgetedMinor must be a whole number of at least 0; currency must be one of/);
  });
});

describe("approval rules", () => {
  it("rejects an overlapping bounded band and max not above min", async () => {
    const { finance } = await seedOrg();
    await expect(
      createApprovalRule({ minMinor: 10_000, maxMinor: 60_000, approverRole: "MANAGER", currency: "EUR" }, finance.id),
    ).rejects.toThrow("This amount band overlaps step 1");
    await expect(
      createApprovalRule({ minMinor: 500, maxMinor: 500, approverRole: "MANAGER", currency: "USD" }, finance.id),
    ).rejects.toThrow("maxMinor must be greater than minMinor");
  });

  it("allows a touching band in the same currency and any band in another currency", async () => {
    const { finance, rules } = await seedOrg();
    await updateApprovalRule(rules[0].id, { maxMinor: 40_000 }, finance.id);
    const touching = await createApprovalRule(
      { minMinor: 40_000, maxMinor: 50_000, approverRole: "FINANCE", currency: "EUR" },
      finance.id,
    );
    expect(touching.sequence).toBe(3);
    const usd = await createApprovalRule(
      { minMinor: 0, maxMinor: 60_000, approverRole: "MANAGER", currency: "USD" },
      finance.id,
    );
    expect(usd.sequence).toBe(1);
    await expect(updateApprovalRule(touching.id, { minMinor: 30_000 }, finance.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("parses required fields and roles", () => {
    expect(() => parseApprovalRuleInput({ approverRole: "BOSS" })).toThrow(
      /approverRole must be one of MANAGER, FINANCE, ADMIN; minMinor is required; currency is required/,
    );
    expect(parseApprovalRuleInput({ minMinor: 0, approverRole: "ADMIN", currency: "EUR" })).toEqual({
      maxMinor: null,
      minMinor: 0,
      approverRole: "ADMIN",
      currency: "EUR",
    });
  });

  it("leaves archived rules out of the approval chain", async () => {
    const { requester, finance, supplier, cc, rules } = await seedOrg();
    await archiveApprovalRule(rules[0].id, finance.id);
    await createApprovalRule({ minMinor: 0, maxMinor: 50_000, approverRole: "ADMIN", currency: "EUR" }, finance.id);
    const req = await createRequisitionWithLine(requester.id, supplier.id, cc.id, 1, 1_000);
    await submitRequisition(req.id, requester.id);
    const steps = await db.select().from(approvals).where(eq(approvals.requisitionId, req.id));
    expect(steps.map((s) => s.approverRole)).toEqual(["ADMIN"]);
  });
});

describe("archived master data on new requisitions", () => {
  it("is hidden from the picker and rejected by POST /requisitions", async () => {
    const { requester, finance, supplier, cc } = await seedOrg();
    await archiveSupplier(supplier.id, finance.id);
    await archiveCostCenter(cc.id, finance.id);
    const cookie = `hexprocure_session=${await startSession(requester.id)}`;

    const picker = await (await options(new Request("http://x", { headers: { cookie } }))).json();
    expect(picker).toEqual({ suppliers: [], costCenters: [] });

    const res = await createRequisition(
      new Request("http://x", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          supplierId: supplier.id,
          costCenterId: cc.id,
          lines: [{ description: "Pens", quantity: 1, unitPriceMinor: 100 }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(
      "supplierId must be an active supplier; costCenterId must be an active cost center",
    );
  });
});

describe("duplicate names under concurrency", () => {
  it("lets exactly one of two simultaneous supplier creates win, case-insensitively", async () => {
    const { requester } = await seedOrg();
    const results = await Promise.allSettled([
      createSupplier({ name: "Nord", email: null }, requester.id),
      createSupplier({ name: "NORD", email: null }, requester.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
  });

  it("lets exactly one of two simultaneous cost center creates win", async () => {
    const { requester } = await seedOrg();
    const results = await Promise.allSettled([
      createCostCenter({ name: "Ops" }, requester.id),
      createCostCenter({ name: "ops" }, requester.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
  });
});
