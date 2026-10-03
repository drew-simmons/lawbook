import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { TEMPLATE } from "../src/init.ts";
import { lawbook, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

test("init writes lawbook.yaml and exits zero", async () => {
  const result = await lawbook("init", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`wrote ${path.join(dir(), "lawbook.yaml")}\n`);
  expect(await readFile(path.join(dir(), "lawbook.yaml"), "utf8")).toBe(TEMPLATE);
});

test("init refuses to overwrite lawbook.yaml and exits two", async () => {
  await write(dir(), "lawbook.yaml", "version: 1\nrules: []\n");
  const result = await lawbook("init", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(`error: ${path.join(dir(), "lawbook.yaml")} already exists\n`);
  expect(await readFile(path.join(dir(), "lawbook.yaml"), "utf8")).toBe("version: 1\nrules: []\n");
});

test("init refuses when lawbook.json exists", async () => {
  await write(dir(), "lawbook.json", "{}");
  const result = await lawbook("init", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("lawbook.json already exists");
});

test("init fails with exit two when the directory is missing", async () => {
  const result = await lawbook("init", path.join(dir(), "missing"));
  expect(result.code).toBe(2);
  expect(result.stderr).toMatch(/^error: .*ENOENT/u);
});

test("init output passes check", async () => {
  expect((await lawbook("init", dir())).code).toBe(0);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS no-env-file\n");
  expect(result.stdout).toContain("PASS no-merge-markers\n");
  expect(result.stdout).toContain("2 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n");
});
