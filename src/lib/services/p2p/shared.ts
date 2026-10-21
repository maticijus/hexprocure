import type { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";

export class DomainError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "BUDGET_EXCEEDED"
      | "FORBIDDEN"
      | "LLM_UNAVAILABLE"
      | "LICENSE_REQUIRED"
      | "VALIDATION",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  tx: DbOrTx,
  entityType: string,
  entityId: string,
  action: string,
  actorUserId?: string | null,
  payload?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    entityType,
    entityId,
    action,
    actorUserId: actorUserId ?? null,
    payload,
  });
}

type PgError = { code?: string; constraint?: string };

export function pgError(error: unknown): PgError {
  return (error as { cause?: PgError }).cause ?? (error as PgError);
}

export function pgErrorCode(error: unknown): string | undefined {
  return (error as PgError).code ?? pgError(error).code;
}

type TxCallback = Parameters<typeof db.transaction>[0];
export type Tx = Parameters<TxCallback>[0];
