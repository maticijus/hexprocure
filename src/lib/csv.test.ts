import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, doubled quotes, CRLF and blank lines", () => {
    const text = '﻿name,email\r\n"Acme, Inc.",a@acme.test\r\n\r\n"Say ""hi""",\nPlain,"multi\nline"';
    expect(parseCsv(text)).toEqual([
      ["name", "email"],
      ["Acme, Inc.", "a@acme.test"],
      ['Say "hi"', ""],
      ["Plain", "multi\nline"],
    ]);
  });

  it("drops one leading byte order mark so the first header matches", () => {
    expect(parseCsv("\uFEFFname,email\nA,a@x.test")[0]).toEqual(["name", "email"]);
  });
});
