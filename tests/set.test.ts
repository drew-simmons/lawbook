import path from "node:path";
import { expect, test } from "vitest";
import { NO_TOTALS } from "../src/result.ts";
import {
  fakeJudge,
  lawbook,
  lawbookWith,
  noul,
  requestKey,
  usageLine,
  usageTotals,
  useTempDir,
  write,
} from "./helpers.ts";

const dir = useTempDir();

const SET =
  "  - id: consistent-naming\n    files: ['**/*.ts']\n    scope: set\n    standard: Names follow one convention across files\n";

async function config(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

async function twoFiles(): Promise<void> {
  await write(dir(), "b.ts", "const b = 1;\n");
  await write(dir(), "a.ts", "const a = 1;\n");
}

test("scope: set sends every selected file in one request in path order", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(result.code).toBe(0);
  expect(fake.requests).toEqual([
    {
      standard: "Names follow one convention across files",
      files: [
        { path: "a.ts", content: "const a = 1;\n" },
        { path: "b.ts", content: "const b = 1;\n" },
      ],
    },
  ]);
  expect(result.stdout).toBe(
    `PASS consistent-naming\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
  );
});

test("scope: set below the threshold fails with one finding and a decision on the result", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  const fake = fakeJudge({ "a.ts,b.ts": noul(0.3, "names differ between a.ts and b.ts") });
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    `FAIL consistent-naming\n  names differ between a.ts and b.ts (noul 0.30)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
  );
  const json = await lawbookWith(
    fakeJudge({ "a.ts,b.ts": noul(0.3, "r") }).deps,
    "check",
    dir(),
    "--no-cache",
    "--format",
    "json",
  );
  expect(JSON.parse(json.stdout).results[0]).toEqual({
    id: "consistent-naming",
    kind: "standard",
    level: "error",
    status: "fail",
    findings: [{ message: "r", decision: { type: "noul", noul: 0.3 } }],
    decision: { type: "noul", noul: 0.3 },
    usage: usageTotals(1),
  });
});

test("scope: set with no files passes without a request", async () => {
  await config(`rules:\n${SET}`);
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--format", "json");
  expect(fake.requests).toEqual([]);
  expect(JSON.parse(result.stdout).results[0]).toEqual({
    id: "consistent-naming",
    kind: "standard",
    level: "error",
    status: "pass",
    findings: [],
    usage: NO_TOTALS,
  });
});

test("scope: set over llm.maxBytes errors without a request", async () => {
  await config(`llm:\n  maxBytes: 16\nrules:\n${SET}`);
  await twoFiles();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(fake.requests).toEqual([]);
  expect(result.stdout).toBe(
    "ERROR consistent-naming\n  set of 2 files is 26 bytes, over llm.maxBytes 16\n\n0 passed, 0 failed, 0 warned, 1 errored, 0 skipped\n",
  );
});

test("scope: set leaves suppressed files out and lists them as skipped", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  await write(dir(), "a.ts", "// lawbook-disable-file consistent-naming\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(fake.requests.map(requestKey)).toEqual(["b.ts"]);
  expect(result.stdout).toContain(
    "PASS consistent-naming\n  a.ts: suppressed by lawbook-disable-file\n",
  );
});

test("scope: set caches the whole set and a changed file misses", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  const cacheDir = path.join(dir(), "cache");
  const run = async () => {
    const fake = fakeJudge();
    await lawbookWith(fake.deps, "check", dir(), "--cache-dir", cacheDir);
    return fake.requests.length;
  };
  expect(await run()).toBe(1);
  expect(await run()).toBe(0);
  await write(dir(), "b.ts", "const b = 2;\n");
  expect(await run()).toBe(1);
});

test("an unknown scope is rejected", async () => {
  await config("rules:\n  - id: s\n    files: ['**/*.ts']\n    scope: repo\n    standard: x\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

test("--dry-run counts one request for a set rule with files and none without", async () => {
  await config(
    `rules:\n${SET}  - id: per-file\n    files: ['**/*.ts']\n    standard: y\n  - id: empty\n    files: ['**/*.md']\n    scope: set\n    standard: z\n`,
  );
  await twoFiles();
  const result = await lawbook("check", dir(), "--dry-run");
  expect(result.stdout).toContain("PLAN consistent-naming (standard, 2 files)");
  expect(result.stdout).toContain("\n2 files, 3 model requests\n");
});

test("a set request carries the rule's context", async () => {
  await config(`rules:\n${SET}    context: [docs/style.md]\n`);
  await write(dir(), "docs/style.md", "# Style\n");
  await twoFiles();
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0]?.context).toEqual([{ path: "docs/style.md", content: "# Style\n" }]);
  expect(fake.requests[0]?.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
});

test("--explain on a passing set prints its one reason", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  const fake = fakeJudge({ "a.ts,b.ts": noul(0.9, "the names line up") });
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache", "--explain");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(
    "PASS consistent-naming\n  passed, the names line up (noul 0.90)\n",
  );
  const json = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--no-cache",
    "--explain",
    "--format",
    "json",
  );
  expect(JSON.parse(json.stdout).results[0].reason).toBe("the names line up");
});

test("--explain on a failing set adds no reason, since the finding carries it", async () => {
  await config(`rules:\n${SET}`);
  await twoFiles();
  const fake = fakeJudge({ "a.ts,b.ts": noul(0.2, "they differ") });
  const result = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--no-cache",
    "--explain",
    "--format",
    "json",
  );
  expect(JSON.parse(result.stdout).results[0]).not.toHaveProperty("reason");
});
