import { expect, test } from "vitest";
import { parseSuppressions, suppressed } from "../src/suppress.ts";
import { fakeJudge, lawbook, lawbookWith, usageLine, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

async function config(rules: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\nrules:\n${rules}`);
}

const NO_TODO = "  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n";
const HEADER = "  - id: header\n    files: ['**/*.ts']\n    require: 'Copyright'\n";
const STANDARD =
  "  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";
const CLEAN = "0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n";

test("parseSuppressions maps each marker kind to the right line or the file", () => {
  const marks = parseSuppressions(
    "a\n// lawbook-disable-next-line x, y\nb\n// lawbook-disable-line z\n/* lawbook-disable-file w */\n",
  );
  expect(marks.file).toEqual(new Set(["w"]));
  expect(marks.lines).toEqual(
    new Map([
      [3, new Set(["x", "y"])],
      [4, new Set(["z"])],
    ]),
  );
});

test("parseSuppressions reads two markers on one line and tolerates one on the last line", () => {
  const marks = parseSuppressions("// lawbook-disable-line a lawbook-disable-next-line b");
  expect(marks.lines).toEqual(
    new Map([
      [1, new Set(["a"])],
      [2, new Set(["b"])],
    ]),
  );
  expect(parseSuppressions("").lines.size).toBe(0);
});

test("suppressed answers for the file, for a line, and for an unknown id", () => {
  const marks = parseSuppressions("// lawbook-disable-line a\n// lawbook-disable-file f\n");
  expect(suppressed(marks, "a", 1)).toBe(true);
  expect(suppressed(marks, "a", 2)).toBe(false);
  expect(suppressed(marks, "a")).toBe(false);
  expect(suppressed(marks, "f")).toBe(true);
  expect(suppressed(marks, "f", 7)).toBe(true);
  expect(suppressed(marks, "nope", 1)).toBe(false);
});

test("forbid skips the line after a next-line marker", async () => {
  await config(NO_TODO);
  await write(
    dir(),
    "a.ts",
    "// TODO one\n// lawbook-disable-next-line no-todo\n// TODO two\n// TODO three\n",
  );
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(
    `FAIL no-todo\n  a.ts:1: // TODO one\n  a.ts:4: // TODO three\n\n${CLEAN}`,
  );
});

test("forbid skips the line a line marker is on", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO one // lawbook-disable-line no-todo\n// TODO two\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`FAIL no-todo\n  a.ts:2: // TODO two\n\n${CLEAN}`);
});

test("forbid reports nothing for a file that disables it", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// lawbook-disable-file no-todo\n// TODO\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS no-todo\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("require passes a file that disables it but not one with a line marker", async () => {
  await config(HEADER);
  await write(dir(), "a.ts", "// lawbook-disable-file header\n");
  await write(dir(), "b.ts", "// lawbook-disable-line header\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`FAIL header\n  b.ts: does not match /Copyright/\n\n${CLEAN}`);
});

test("standard lists a file that disables it as skipped without a request", async () => {
  await config(STANDARD);
  await write(
    dir(),
    "a.ts",
    "// lawbook-disable-file actionable-errors\nthrow new Error('bad');\n",
  );
  await write(dir(), "b.ts", "const b = 1;\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(fake.requests.map((request) => request.path)).toEqual(["b.ts"]);
  expect(result.stdout).toBe(
    `PASS actionable-errors\n  a.ts: suppressed by lawbook-disable-file\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
  );
});

test("a marker naming another rule changes nothing", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// lawbook-disable-next-line other\n// TODO\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`FAIL no-todo\n  a.ts:2: // TODO\n\n${CLEAN}`);
});

test("exists and absent ignore markers in the file", async () => {
  await config("  - id: no-env\n    absent: .env\n");
  await write(dir(), ".env", "# lawbook-disable-file no-env\nSECRET=1\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`FAIL no-env\n  .env: exists\n\n${CLEAN}`);
});
