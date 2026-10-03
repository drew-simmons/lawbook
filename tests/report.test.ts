import { expect, test } from "vitest";
import { formatGithub } from "../src/github.ts";
import { fingerprint, formatGitlab } from "../src/gitlab.ts";
import { formatJson, formatText } from "../src/report.ts";
import { formatSarif } from "../src/sarif.ts";
import { type RuleResult, summarize } from "../src/result.ts";
import { pathToFileURL } from "node:url";
import path from "node:path";

test("text output omits the location when a finding has none", () => {
  const report = summarize([
    {
      id: "a",
      kind: "exists",
      level: "error",
      status: "fail",
      findings: [{ message: "no location" }],
    },
    { id: "b", kind: "forbid", level: "error", status: "skip", findings: [] },
  ]);
  expect(formatText(report)).toBe(
    "FAIL a\n  no location\nSKIP b\n\n0 passed, 1 failed, 0 warned, 0 errored, 1 skipped\n",
  );
});

test("text output appends the probability to a finding with a noul decision", () => {
  const decision = { type: "noul" as const, noul: 0.123 };
  const report = summarize([
    {
      id: "s",
      kind: "standard",
      level: "error",
      status: "fail",
      findings: [{ path: "a.ts", message: "r", decision }],
      decisions: { "a.ts": decision },
    },
  ]);
  expect(formatText(report)).toBe(
    "FAIL s\n  a.ts: r (noul 0.12)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("json output has no decisions key for a deterministic result", () => {
  const report = summarize([
    { id: "a", kind: "exists", level: "error", status: "fail", findings: [{ message: "missing" }] },
  ]);
  const [result] = JSON.parse(formatJson(report)).results;
  expect(result).toEqual({
    id: "a",
    kind: "exists",
    level: "error",
    status: "fail",
    findings: [{ message: "missing" }],
  });
  expect(result).not.toHaveProperty("decisions");
});

test("json output ends with a newline", () => {
  const report = summarize([]);
  expect(formatJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});

const META = { version: "1.2.3", root: "/r", config: "lawbook.yaml" };
const SUMMARY = "0 passed, 1 failed, 0 warned, 0 errored, 0 skipped";

function failing(id: string, findings: RuleResult["findings"], extra: Partial<RuleResult> = {}) {
  return summarize([{ id, kind: "forbid", level: "error", status: "fail", findings, ...extra }]);
}

test("github output escapes property values and messages", () => {
  const report = failing("no:todo", [{ path: "a,b.ts", line: 3, message: "x%\r\ny" }]);
  expect(formatGithub(report)).toBe(
    `::error file=a%2Cb.ts,line=3,title=no%3Atodo::x%25%0D%0Ay\n::notice title=lawbook::${SUMMARY}\n`,
  );
});

test("github output uses warning for warn rules and omits file without a path", () => {
  const report = failing("readme", [{ message: "missing" }], { level: "warn", status: "warn" });
  expect(formatGithub(report)).toBe(
    "::warning title=readme::missing\n::notice title=lawbook::0 passed, 0 failed, 1 warned, 0 errored, 0 skipped\n",
  );
});

test("github output appends the probability to a judged finding", () => {
  const decision = { type: "noul" as const, noul: 0.123 };
  const report = failing("s", [{ path: "a.ts", message: "r", decision }]);
  expect(formatGithub(report)).toContain("::error file=a.ts,title=s::r (noul 0.12)\n");
});

test("sarif output lists every rule and one result per finding", () => {
  const report = summarize([
    {
      id: "a",
      kind: "forbid",
      level: "error",
      description: "No a",
      status: "fail",
      findings: [
        { path: "x.ts", line: 2, message: "m1" },
        { path: "y.ts", line: 5, message: "m2" },
      ],
    },
    { id: "b", kind: "exists", level: "warn", status: "pass", findings: [] },
  ]);
  const sarif = JSON.parse(formatSarif(report, META));
  expect(sarif.version).toBe("2.1.0");
  expect(sarif.runs[0].tool.driver).toEqual({
    name: "lawbook",
    version: "1.2.3",
    informationUri: "https://drew-simmons.github.io/lawbook/",
    rules: [
      { id: "a", shortDescription: { text: "No a" } },
      { id: "b", shortDescription: { text: "b" } },
    ],
  });
  expect(sarif.runs[0].results).toEqual([
    {
      ruleId: "a",
      level: "error",
      message: { text: "m1" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "x.ts", uriBaseId: "ROOT" },
            region: { startLine: 2 },
          },
        },
      ],
    },
    {
      ruleId: "a",
      level: "error",
      message: { text: "m2" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "y.ts", uriBaseId: "ROOT" },
            region: { startLine: 5 },
          },
        },
      ],
    },
  ]);
});

test("sarif output omits region without a line and locations without a path", () => {
  const report = summarize([
    {
      id: "r",
      kind: "require",
      level: "warn",
      status: "warn",
      findings: [{ path: "x.ts", message: "no match" }, { message: "nowhere" }],
    },
  ]);
  const [withPath, without] = JSON.parse(formatSarif(report, META)).runs[0].results;
  expect(withPath).toEqual({
    ruleId: "r",
    level: "warning",
    message: { text: "no match" },
    locations: [{ physicalLocation: { artifactLocation: { uri: "x.ts", uriBaseId: "ROOT" } } }],
  });
  expect(without).toEqual({ ruleId: "r", level: "warning", message: { text: "nowhere" } });
});

test("sarif output roots ROOT at the checked directory with a trailing slash", () => {
  const sarif = JSON.parse(formatSarif(summarize([]), { ...META, version: "0", root: "some/dir/" }));
  expect(sarif.runs[0].originalUriBaseIds).toEqual({
    ROOT: { uri: `${pathToFileURL(path.resolve("some/dir")).href}/` },
  });
  expect(formatSarif(summarize([]), META)).toMatch(/\n$/u);
});

test("gitlab output has one issue per finding with severity by status", () => {
  const report = summarize([
    {
      id: "a",
      kind: "forbid",
      level: "error",
      status: "fail",
      findings: [{ path: "x.ts", line: 2, message: "m1" }],
    },
    {
      id: "b",
      kind: "require",
      level: "warn",
      status: "warn",
      findings: [{ path: "y.ts", message: "m2" }],
    },
    {
      id: "c",
      kind: "standard",
      level: "error",
      status: "error",
      findings: [{ path: "z.ts", message: "boom" }],
    },
    { id: "d", kind: "exists", level: "error", status: "pass", findings: [] },
  ]);
  const issues = JSON.parse(formatGitlab(report, META));
  expect(issues.map((issue: { severity: string }) => issue.severity)).toEqual([
    "major",
    "minor",
    "critical",
  ]);
  expect(issues[0]).toEqual({
    description: "m1",
    check_name: "a",
    fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    severity: "major",
    location: { path: "x.ts", lines: { begin: 2 } },
  });
  expect(issues[1].location).toEqual({ path: "y.ts", lines: { begin: 1 } });
});

test("gitlab fingerprint ignores the line and changes with the message", () => {
  const result: RuleResult = {
    id: "a",
    kind: "forbid",
    level: "error",
    status: "fail",
    findings: [],
  };
  const moved = fingerprint(result, { path: "x.ts", line: 9, message: "m" });
  expect(moved).toBe(fingerprint(result, { path: "x.ts", line: 2, message: "m" }));
  expect(moved).not.toBe(fingerprint(result, { path: "x.ts", line: 9, message: "n" }));
  expect(moved).not.toBe(
    fingerprint({ ...result, id: "b" }, { path: "x.ts", line: 9, message: "m" }),
  );
});

test("gitlab locates a pathless finding at the config file and carries the probability", () => {
  const report = failing("set", [{ message: "too loose", decision: { type: "noul", noul: 0.2 } }]);
  const [issue] = JSON.parse(formatGitlab(report, META));
  expect(issue.description).toBe("too loose (noul 0.20)");
  expect(issue.location).toEqual({ path: "lawbook.yaml", lines: { begin: 1 } });
});

test("gitlab output with no findings is an empty array", () => {
  expect(formatGitlab(summarize([]), META)).toBe("[]\n");
});
