import { SUPPORTED_CURRENCIES } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { DomainError } from "@/lib/services/p2p/shared";

/** Hand-rolled body validation shared by the master data routes. Each check
 *  pushes a readable message into `errors` and returns the cleaned value, so a
 *  route reports every problem at once. In partial mode (PATCH) absent keys are
 *  skipped. */
export class BodyReader {
  readonly errors: string[] = [];
  private readonly body: Record<string, unknown>;

  constructor(raw: unknown, private readonly partial = false) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new DomainError("VALIDATION", "Body must be a JSON object");
    }
    this.body = raw as Record<string, unknown>;
  }

  private skip(field: string): boolean {
    return this.partial && !(field in this.body);
  }

  string(field: string, max = 200): string | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (typeof value !== "string" || !value.trim()) {
      this.errors.push(`${field} is required`);
      return undefined;
    }
    if (value.trim().length > max) {
      this.errors.push(`${field} must be at most ${max} characters`);
      return undefined;
    }
    return value.trim();
  }

  email(field: string): string | null | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      this.errors.push(`${field} must be a valid email address`);
      return undefined;
    }
    return value.trim().toLowerCase();
  }

  currency(field: string): string | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (!(SUPPORTED_CURRENCIES as readonly unknown[]).includes(value)) {
      this.errors.push(`${field} must be one of ${SUPPORTED_CURRENCIES.join(", ")}`);
      return undefined;
    }
    return value as string;
  }

  yearMonth(field: string): string | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      this.errors.push(`${field} must look like 2026-01`);
      return undefined;
    }
    return value;
  }

  nonNegativeInt(field: string): number | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      this.errors.push(`${field} must be a whole number of at least 0`);
      return undefined;
    }
    return value as number;
  }

  /** null clears the value (an open-ended approval band). */
  optionalNonNegativeInt(field: string): number | null | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (value === undefined || value === null) return null;
    return this.nonNegativeInt(field);
  }

  uuid(field: string): string | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (typeof value !== "string" || !isUuid(value)) {
      this.errors.push(`${field} must be a valid id`);
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[]): T | undefined {
    if (this.skip(field)) return undefined;
    const value = this.body[field];
    if (!(allowed as readonly unknown[]).includes(value)) {
      this.errors.push(`${field} must be one of ${allowed.join(", ")}`);
      return undefined;
    }
    return value as T;
  }

  /** Throws one VALIDATION error listing every problem found so far. */
  done(): void {
    if (this.errors.length > 0) {
      throw new DomainError("VALIDATION", this.errors.join("; "), { errors: this.errors });
    }
  }
}

/** Drops undefined keys so a PATCH only touches the fields that were sent. */
export function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<T>;
}
