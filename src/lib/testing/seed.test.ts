import { describe, it, expect } from "vitest";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { TRUNCATE_TABLES } from "./seed";

describe("TRUNCATE_TABLES", () => {
  it("covers every table defined in the schema", () => {
    const pgTables = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t));

    const missing = pgTables.filter((t) => !TRUNCATE_TABLES.includes(t));
    expect(missing).toEqual([]);
  });
});
