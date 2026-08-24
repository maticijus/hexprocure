import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStore } from "./file-store";

let dir: string;
let store: LocalFileStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hex-store-"));
  store = new LocalFileStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("LocalFileStore", () => {
  it("round-trips bytes through put/get", async () => {
    const key = await store.put(Buffer.from([1, 2, 3, 250]), "invoice.pdf");
    expect(key).not.toContain("invoice.pdf");
    const content = await store.get(key);
    expect(content.equals(Buffer.from([1, 2, 3, 250]))).toBe(true);
  });

  it("generates unique keys for identical content", async () => {
    const k1 = await store.put(Buffer.from("same"), "a.pdf");
    const k2 = await store.put(Buffer.from("same"), "b.pdf");
    expect(k1).not.toBe(k2);
  });

  it("throws NOT_FOUND-style error on missing key", async () => {
    await expect(store.get("ghost-key")).rejects.toThrow(/not found/i);
  });

  it("deletes objects", async () => {
    const key = await store.put(Buffer.from("x"), "x.txt");
    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow(/not found/i);
  });
});
