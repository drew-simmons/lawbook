import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { cacheKey, DEFAULT_CACHE_DIR } from "../src/judge/cache.ts";
import {
  fakeJudge,
  requestKey,
  lawbookWith,
  noul,
  usageLine,
  useTempDir,
  write,
} from "./helpers.ts";

const dir = useTempDir();

const STANDARD =
  "  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";
const FAIL =
  "FAIL actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n";

async function config(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

const cacheDir = () => path.join(dir(), "cache");

/** A run with a fresh fake judge that fails a.ts, in the given cache dir. */
async function run(...args: string[]) {
  const fake = fakeJudge({ "a.ts": noul(0.1, "'bad' names no next step") });
  const result = await lawbookWith(fake.deps, "check", dir(), "--cache-dir", cacheDir(), ...args);
  return { ...result, requests: fake.requests.map(requestKey) };
}

test("a second run answers from the cache without a request", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  const first = await run();
  expect(first.requests).toEqual(["a.ts"]);
  expect(first.stdout).toBe(`${FAIL}${usageLine(1)}`);
  const second = await run();
  expect(second.code).toBe(1);
  expect(second.requests).toEqual([]);
  expect(second.stdout).toBe(`${FAIL}${usageLine(0, 1)}`);
});

test("--no-cache asks the model again and stores nothing", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  expect((await run("--no-cache")).requests).toEqual(["a.ts"]);
  expect((await run()).requests).toEqual(["a.ts"]);
  expect((await run("--no-cache")).requests).toEqual(["a.ts"]);
  expect((await run()).requests).toEqual([]);
});

test("llm.cache: false turns the cache off", async () => {
  await config(`llm:\n  cache: false\nrules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  await run();
  expect((await run()).requests).toEqual(["a.ts"]);
});

test("a changed file, standard, or model misses the cache", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  await run();
  await write(dir(), "a.ts", "throw new Error('bad!');\n");
  expect((await run()).requests).toEqual(["a.ts"]);
  await config(
    "rules:\n  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do\n",
  );
  expect((await run()).requests).toEqual(["a.ts"]);
  await config(`llm:\n  model: anthropic.claude-sonnet-5-5\nrules:\n${STANDARD}`);
  expect((await run()).requests).toEqual(["a.ts"]);
  expect((await run()).requests).toEqual([]);
});

test("the default cache dir is node_modules/.cache/lawbook under the root", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await lawbookWith(fakeJudge().deps, "check", dir());
  const entries = await readdir(path.join(dir(), DEFAULT_CACHE_DIR));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/u);
  expect(DEFAULT_CACHE_DIR).toBe("node_modules/.cache/lawbook");
});

test("a corrupt cache entry is a miss and is rewritten", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  const key = cacheKey("anthropic.claude-haiku-4-5", {
    standard: "Errors say what to do next",
    files: [{ path: "a.ts", content: "throw new Error('bad');\n" }],
  });
  const file = path.join(cacheDir(), `${key}.json`);
  await write(dir(), "cache/placeholder", "");
  await writeFile(file, "{ not json");
  expect((await run()).requests).toEqual(["a.ts"]);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    decision: { type: "noul", noul: 0.1 },
    reason: "'bad' names no next step",
  });
  expect((await run()).requests).toEqual([]);
});

test("a cache dir that cannot be created reports the file as an error", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "notadir", "");
  const fake = fakeJudge();
  const result = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--cache-dir",
    path.join(dir(), "notadir"),
  );
  expect(result.code).toBe(2);
  expect(result.stdout).toMatch(
    /^ERROR actionable-errors\n  a\.ts: cannot write cache file .*notadir.*; pass --no-cache or --cache-dir\n/u,
  );
});

test("cacheKey is stable and changes with every field", () => {
  const a = { path: "a", content: "ca" };
  const b = { path: "b", content: "cb" };
  const request = { standard: "s", files: [a, b] };
  const key = cacheKey("m", request);
  expect(key).toMatch(/^[0-9a-f]{64}$/u);
  expect(cacheKey("m", request)).toBe(key);
  expect(cacheKey("m2", request)).not.toBe(key);
  expect(cacheKey("m", { ...request, standard: "s2" })).not.toBe(key);
  expect(cacheKey("m", { standard: "s", files: [{ ...a, path: "a2" }, b] })).not.toBe(key);
  expect(cacheKey("m", { ...request, context: [] })).toBe(key);
  expect(cacheKey("m", { ...request, context: [a] })).not.toBe(key);
  expect(cacheKey("m", { standard: "s", files: [a, { ...b, content: "x" }] })).not.toBe(key);
  expect(cacheKey("m", { standard: "s", files: [b, a] })).not.toBe(key);
});

test("rules that differ only in model cache their verdicts apart", async () => {
  await config(
    `rules:\n${STANDARD}  - id: again\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n    llm: { model: other }\n`,
  );
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  const first = await run();
  expect(first.requests).toEqual(["a.ts", "a.ts"]);
  expect((await readdir(cacheDir())).length).toBe(2);
  expect((await run()).requests).toEqual([]);
});

test("--explain shows a cached verdict's reason", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "fine();\n");
  const fake = fakeJudge({ "a.ts": noul(0.9, "clear next steps") });
  await lawbookWith(fake.deps, "check", dir(), "--cache-dir", cacheDir());
  const second = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--cache-dir",
    cacheDir(),
    "--explain",
  );
  expect(second.stdout).toContain(
    "PASS actionable-errors\n  a.ts: passed, clear next steps (noul 0.90)\n",
  );
  expect(second.stdout).toContain(usageLine(0, 1));
});
