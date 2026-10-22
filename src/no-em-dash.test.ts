import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EM_DASH = String.fromCharCode(0x2014);
const ROOTS = ["src", "scripts", "tests"];
const EXT = /\.(ts|tsx|sh|mjs)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : EXT.test(name) ? [full] : [];
  });
}

describe("house style", () => {
  it("has no em dash in source, scripts or tests", () => {
    const offenders = ROOTS.flatMap(walk).filter((f) => readFileSync(f, "utf8").includes(EM_DASH));
    expect(offenders).toEqual([]);
  });
});
