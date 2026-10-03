import path from "node:path";
import { expect, test } from "vitest";
import { lawbook, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

test("check without config exits two and suggests init", async () => {
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`no lawbook.yaml, lawbook.yml, lawbook.json found in ${dir()}`);
  expect(result.stderr).toContain("lawbook init");
});

test("check with invalid yaml exits two", async () => {
  await write(dir(), "lawbook.yaml", "version: 1\nrules: [\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toMatch(/^error: .*lawbook\.yaml: /u);
});

test("check rejects an unknown rule key", async () => {
  await write(dir(), "lawbook.yaml", "version: 1\nrules:\n  - id: a\n    forbids: x\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("lawbook.yaml:");
  expect(result.stderr).toContain("rules[0]");
});

test("check rejects an unknown top-level key", async () => {
  await write(dir(), "lawbook.yaml", "version: 1\nrule: []\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('Unrecognized key: "rule"');
});

test("check rejects a rule with two kinds", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: a\n    exists: x\n    absent: y\n",
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

const STANDARD = "  - id: s\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";

test.each([
  ["above one", "1.5"],
  ["negative", "-0.1"],
])("check rejects a threshold that is %s", async (_name, threshold) => {
  await write(
    dir(),
    "lawbook.yaml",
    `version: 1\nrules:\n${STANDARD}    threshold: ${threshold}\n`,
  );
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

test.each([
  ["zero", "0"],
  ["a fraction", "1.5"],
  ["a word", "two"],
])("check rejects an llm.concurrency that is %s", async (_name, concurrency) => {
  await write(
    dir(),
    "lawbook.yaml",
    `version: 1\nllm:\n  concurrency: ${concurrency}\nrules:\n${STANDARD}`,
  );
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("llm.concurrency");
});

test.each([
  ["zero", "0"],
  ["a fraction", "1.5"],
  ["a word", "big"],
])("check rejects an llm.maxBytes that is %s", async (_name, maxBytes) => {
  await write(
    dir(),
    "lawbook.yaml",
    `version: 1\nllm:\n  maxBytes: ${maxBytes}\nrules:\n${STANDARD}`,
  );
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("llm.maxBytes");
});

test("check rejects threshold on a deterministic rule", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: a\n    files: ['**/*']\n    forbid: x\n    threshold: 0.5\n",
  );
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

test("check rejects an unknown level", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: a\n    level: fatal\n    exists: x\n",
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

test("check rejects duplicate ids", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: a\n    exists: x\n  - id: a\n    absent: y\n",
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('duplicate rule id "a"');
});

test("check rejects an unsupported version", async () => {
  await write(dir(), "lawbook.yaml", "version: 2\nrules: []\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("version");
});

test("check accepts lawbook.json", async () => {
  await write(
    dir(),
    "lawbook.json",
    '{ "version": 1, "rules": [{ "id": "a", "absent": ".env" }] }',
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS a\n");
});

test("check prefers lawbook.yaml over lawbook.yml", async () => {
  await write(dir(), "lawbook.yaml", "version: 1\nrules:\n  - id: from-yaml\n    absent: .env\n");
  await write(dir(), "lawbook.yml", "version: 1\nrules:\n  - id: from-yml\n    absent: .env\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toContain("PASS from-yaml\n");
  expect(result.stdout).not.toContain("from-yml");
});

test("check --config uses an explicit path", async () => {
  const file = path.join(dir(), "rules", "custom.yaml");
  await write(dir(), "rules/custom.yaml", "version: 1\nrules:\n  - id: custom\n    absent: .env\n");
  const result = await lawbook("check", dir(), "--config", file);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS custom\n");
});

test("check --config with a missing file exits two", async () => {
  const file = path.join(dir(), "missing.yaml");
  const result = await lawbook("check", dir(), "--config", file);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`cannot read ${file}`);
});

test("check rejects an invalid regex", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: a\n    files: ['**/*']\n    forbid: '('\n",
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('invalid pattern "("');
});
