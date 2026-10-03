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

test("text output appends the probability to a finding with a noul decision", () => {
  const decision = { type: "noul" as const, noul: 0.123 };
  const report = summarize([
    {
      id: "s",
      kind: "standard",
      status: "fail",
      findings: [{ path: "a.ts", message: "r", decision }],
      decisions: { "a.ts": decision },
    },
  ]);
  expect(formatText(report)).toBe(
    "FAIL s\n  a.ts: r (noul 0.12)\n\n0 passed, 1 failed, 0 skipped\n",
  );
});

test("text output prints nothing extra for a decision that is not noul", () => {
  const decision = { type: "choice" as const, choice: "x", probabilities: { x: 1 }, confidence: 1 };
  const report = summarize([
    {
      id: "s",
      kind: "standard",
      status: "fail",
      findings: [{ path: "a.ts", message: "r", decision }],
    },
  ]);
  expect(formatText(report)).toBe("FAIL s\n  a.ts: r\n\n0 passed, 1 failed, 0 skipped\n");
});

test("json output has no decisions key for a deterministic result", () => {
  const report = summarize([
    { id: "a", kind: "exists", status: "fail", findings: [{ message: "missing" }] },
  ]);
  const [result] = JSON.parse(formatJson(report)).results;
  expect(result).toEqual({
    id: "a",
    kind: "exists",
    status: "fail",
    findings: [{ message: "missing" }],
  });
  expect(result).not.toHaveProperty("decisions");
});

test("json output ends with a newline", () => {
  const report = summarize([]);
  expect(formatJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});
