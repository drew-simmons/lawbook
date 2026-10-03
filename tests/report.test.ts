import { expect, test } from "vitest";
import { formatJson, formatText } from "../src/report.ts";
import { summarize } from "../src/result.ts";

test("text output omits the location when a finding has none", () => {
  const report = summarize([
    { id: "a", kind: "exists", status: "fail", findings: [{ message: "no location" }] },
    { id: "b", kind: "forbid", status: "skip", findings: [] },
  ]);
  expect(formatText(report)).toBe(
    "FAIL a\n  no location\nSKIP b\n\n0 passed, 1 failed, 1 skipped\n",
  );
});

test("json output ends with a newline", () => {
  const report = summarize([]);
  expect(formatJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});
