import path from "node:path";
import { expect, test } from "vitest";
import { fakeJudge, lawbook, lawbookWith, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

async function top(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

const absent = (id: string, file: string) => `  - id: ${id}\n    absent: ${file}\n`;
const CLEAN = "0 failed, 0 warned, 0 errored, 0 skipped\n";

test("extends a local path relative to the config file, its rules first", async () => {
  await write(dir(), "rules/base.yaml", `version: 1\nrules:\n${absent("base", ".env")}`);
  await top(`extends: ./rules/base.yaml\nrules:\n${absent("own", ".secret")}`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`PASS base\nPASS own\n\n2 passed, ${CLEAN}`);
});

test("nested extends are depth-first and a list keeps its order", async () => {
  await write(dir(), "c.yaml", `version: 1\nrules:\n${absent("c", ".c")}`);
  await write(dir(), "b.yaml", `version: 1\nextends: ./c.yaml\nrules:\n${absent("b", ".b")}`);
  await write(dir(), "d.yaml", `version: 1\nrules:\n${absent("d", ".d")}`);
  await top(`extends: ["./b.yaml", "./d.yaml"]\nrules:\n${absent("a", ".a")}`);
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`PASS c\nPASS b\nPASS d\nPASS a\n\n4 passed, ${CLEAN}`);
});

test("extends a package by name through node_modules", async () => {
  await write(
    dir(),
    "node_modules/@acme/rules/package.json",
    '{ "name": "@acme/rules", "main": "lawbook.yaml" }',
  );
  await write(
    dir(),
    "node_modules/@acme/rules/lawbook.yaml",
    `version: 1\nrules:\n${absent("acme", ".env")}`,
  );
  await top(`extends: "@acme/rules"\nrules: []\n`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`PASS acme\n\n1 passed, ${CLEAN}`);
});

test("extends a package subpath through exports", async () => {
  await write(
    dir(),
    "node_modules/@acme/rules/package.json",
    '{ "name": "@acme/rules", "exports": { "./strict.yaml": "./strict.yaml" } }',
  );
  await write(
    dir(),
    "node_modules/@acme/rules/strict.yaml",
    `version: 1\nrules:\n${absent("strict", ".env")}`,
  );
  await top(`extends: "@acme/rules/strict.yaml"\nrules: []\n`);
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(`PASS strict\n\n1 passed, ${CLEAN}`);
});

test("a cycle exits two naming the chain", async () => {
  await write(dir(), "b.yaml", "version: 1\nextends: ./lawbook.yaml\nrules: []\n");
  await top("extends: ./b.yaml\nrules: []\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toMatch(
    /^error: extends cycle: \S*lawbook\.yaml -> \S*b\.yaml -> \S*lawbook\.yaml\n$/u,
  );
});

test("a duplicate id across files names both files", async () => {
  await write(dir(), "base.yaml", `version: 1\nrules:\n${absent("x", ".env")}`);
  await top(`extends: ./base.yaml\nrules:\n${absent("x", ".env")}`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(
    `error: duplicate rule id "x" in ${path.join(dir(), "base.yaml")} and ${path.join(dir(), "lawbook.yaml")}\n`,
  );
});

test("a missing extended file and a missing package exit two", async () => {
  await top("extends: ./nope.yaml\nrules: []\n");
  const missingFile = await lawbook("check", dir());
  expect(missingFile.code).toBe(2);
  expect(missingFile.stderr).toContain(`cannot read ${path.join(dir(), "nope.yaml")}`);
  await top('extends: "@acme/nope"\nrules: []\n');
  const missingPackage = await lawbook("check", dir());
  expect(missingPackage.code).toBe(2);
  expect(missingPackage.stderr).toContain(`lawbook.yaml: cannot resolve extends "@acme/nope"`);
});

test("ignore, gitignore, and llm are not inherited", async () => {
  await write(
    dir(),
    "base.yaml",
    "version: 1\nignore: ['**']\ngitignore: false\nllm:\n  maxBytes: 1\nrules: []\n",
  );
  await top(
    "extends: ./base.yaml\nrules:\n  - id: no-todo\n    files: ['**/*.ts']\n    forbid: TODO\n  - id: s\n    files: ['**/*.ts']\n    standard: Fine\n",
  );
  await write(dir(), "a.ts", "// TODO\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(result.stdout).toContain("FAIL no-todo\n  a.ts:1: // TODO\n");
  expect(fake.built[0]).toMatchObject({ maxBytes: 131072 });
});

test("an extended file is validated like any config", async () => {
  await write(dir(), "base.yaml", "version: 2\nrules: []\n");
  await top("extends: ./base.yaml\nrules: []\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`${path.join(dir(), "base.yaml")}:`);
  expect(result.stderr).toContain("version");
});
