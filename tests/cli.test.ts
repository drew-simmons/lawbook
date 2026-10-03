import { expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { lawbook } from "./helpers.ts";

test("no arguments prints help and exits two", async () => {
  const result = await lawbook();
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("Usage: lawbook");
});

test("version prints package version", async () => {
  const result = await lawbook("--version");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(pkg.version);
});

test("help lists init and check", async () => {
  const result = await lawbook("--help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Usage: lawbook");
  expect(result.stdout).toContain("init");
  expect(result.stdout).toContain("check");
});

test("unknown flag exits two", async () => {
  const result = await lawbook("--no-such-flag");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("--no-such-flag");
});

test("check help lists every output format", async () => {
  const result = await lawbook("check", "--help");
  expect(result.code).toBe(0);
  for (const format of ["text", "json", "github", "sarif"]) {
    expect(result.stdout).toContain(`"${format}"`);
  }
});
