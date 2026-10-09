import { expect, test } from "vitest";
import { fakeJudge, lawbook, lawbookWith, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const STANDARD =
  "  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";

async function config(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

async function twoFiles(): Promise<void> {
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.ts", "const b = 2;\n");
}

test("a run over llm.maxRequests stops before building a judge", async () => {
  await config(`llm:\n  maxRequests: 1\nrules:\n${STANDARD}`);
  await twoFiles();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "error: the run would make 2 model requests, over llm.maxRequests 1; narrow files, pass --only, or raise the limit\n",
  );
  expect(fake.built).toEqual([]);
});

test("a run at llm.maxRequests proceeds", async () => {
  await config(`llm:\n  maxRequests: 2\nrules:\n${STANDARD}`);
  await twoFiles();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(fake.requests).toHaveLength(2);
});

test("an empty file does not count against llm.maxRequests", async () => {
  await config(`llm:\n  maxRequests: 2\nrules:\n${STANDARD}`);
  await twoFiles();
  await write(dir(), "empty.ts", "");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(fake.requests).toHaveLength(2);
});

test("--max-requests overrides llm.maxRequests either way", async () => {
  await config(`llm:\n  maxRequests: 10\nrules:\n${STANDARD}`);
  await twoFiles();
  const fake = fakeJudge();
  const tighter = await lawbookWith(fake.deps, "check", dir(), "--max-requests", "1");
  expect(tighter.code).toBe(2);
  expect(tighter.stderr).toContain("over llm.maxRequests 1");
  await config(`llm:\n  maxRequests: 1\nrules:\n${STANDARD}`);
  const looser = await lawbookWith(fake.deps, "check", dir(), "--max-requests", "5");
  expect(looser.code).toBe(0);
});

test("--no-llm ignores the budget", async () => {
  await config(`llm:\n  maxRequests: 0\nrules:\n${STANDARD}`);
  await twoFiles();
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("SKIP actionable-errors\n");
});

test("--only narrows the count the budget sees", async () => {
  await config(
    `llm:\n  maxRequests: 2\nrules:\n${STANDARD}  - id: second\n    files: ['**/*.ts']\n    standard: Second\n`,
  );
  await twoFiles();
  const fake = fakeJudge();
  expect((await lawbookWith(fake.deps, "check", dir())).code).toBe(2);
  expect((await lawbookWith(fake.deps, "check", dir(), "--only", "second")).code).toBe(0);
});

test("llm.maxRequests rejects negative and fractional values", async () => {
  await config(`llm:\n  maxRequests: -1\nrules:\n${STANDARD}`);
  const negative = await lawbook("check", dir());
  expect(negative.code).toBe(2);
  expect(negative.stderr).toContain("llm.maxRequests");
  await config(`llm:\n  maxRequests: 1.5\nrules:\n${STANDARD}`);
  expect((await lawbook("check", dir())).code).toBe(2);
});

test("--max-requests rejects anything but a whole number", async () => {
  await config(`rules:\n${STANDARD}`);
  const result = await lawbook("check", dir(), "--max-requests", "many");
  expect(result.code).toBe(2);
  expect(result.stderr).toBe('error: --max-requests takes a whole number, not "many"\n');
});
