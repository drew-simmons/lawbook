import path from "node:path";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { underRoot } from "../src/files.ts";
import { changedFiles, git, listedFiles } from "../src/git.ts";
import { gitIn, gitRepo, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

test("changedFiles returns sorted root-relative posix paths", async () => {
  await write(dir(), "kept.ts", "const k = 1;\n");
  await gitRepo(dir());
  await write(dir(), "b/z.ts", "const z = 1;\n");
  await write(dir(), "a.ts", "const a = 1;\n");
  expect(await changedFiles(dir())).toEqual(["a.ts", "b/z.ts"]);
});

test("changedFiles with a ref lists commits since the merge base only", async () => {
  await write(dir(), "a.ts", "const a = 1;\n");
  await gitRepo(dir());
  await gitIn(dir(), "switch", "-q", "-c", "feature");
  await write(dir(), "b.ts", "const b = 1;\n");
  await gitIn(dir(), "add", "-A");
  await gitIn(dir(), "commit", "-q", "-m", "b");
  await write(dir(), "untracked.ts", "const u = 1;\n");
  expect(await changedFiles(dir(), "main")).toEqual(["b.ts"]);
});

test("listedFiles is undefined outside a repository", async () => {
  expect(await listedFiles(dir())).toBeUndefined();
});

test("listedFiles lists tracked and untracked files under the root but not ignored ones", async () => {
  await write(dir(), ".gitignore", "*.log\n");
  await write(dir(), "pkg/a.ts", "");
  await gitRepo(dir());
  await write(dir(), "pkg/b.ts", "");
  await write(dir(), "pkg/c.log", "");
  await write(dir(), "top.ts", "");
  expect(await listedFiles(path.join(dir(), "pkg"))).toEqual(["a.ts", "b.ts"]);
  expect(await listedFiles(dir())).toEqual([".gitignore", "pkg/a.ts", "pkg/b.ts", "top.ts"]);
});

test("git wraps a failure in a CliError naming the command", async () => {
  await gitRepo(dir());
  const failure = git(dir(), ["rev-parse", "--verify", "nope"]);
  await expect(failure).rejects.toThrow(CliError);
  await expect(failure).rejects.toThrow(/^git rev-parse: fatal: /u);
});

const root = path.join("some", "root");

test.each([
  ["a file inside", path.join(root, "a", "b.ts"), "a/b.ts"],
  ["a dotted name inside", path.join(root, "..foo"), "..foo"],
  ["a file beside the root", path.join(root, "..", "x.ts"), undefined],
  ["the parent itself", path.join(root, ".."), undefined],
])("underRoot handles %s", (_name, file, expected) => {
  expect(underRoot(root, file)).toBe(expected);
});
