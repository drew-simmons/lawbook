import { chmod } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { underRoot } from "../src/files.ts";
import { changedFiles, changedLines, git, listedFiles } from "../src/git.ts";
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

/** Commits everything in `dir` on a new branch `feature`, with `a.ts` changed and `b.ts` added. */
async function featureBranch(): Promise<void> {
  await write(dir(), "a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  await write(dir(), "mode.ts", "const m = 1;\n");
  await gitRepo(dir());
  await gitIn(dir(), "switch", "-q", "-c", "feature");
  await write(dir(), "a.ts", "const a = 1;\nconst B = 2;\nconst c = 3;\nconst d = 4;\n");
  await write(dir(), "b.ts", "const b = 1;\nconst b2 = 2;\n");
  // The mode changes on disk and in the index: Windows git ignores the disk
  // mode, and Linux git takes the disk mode when it diffs the working tree.
  await chmod(path.join(dir(), "mode.ts"), 0o755);
  await gitIn(dir(), "add", "-A");
  await gitIn(dir(), "update-index", "--chmod=+x", "mode.ts");
  await gitIn(dir(), "commit", "-q", "-m", "feature");
}

test("changedLines with a ref lists the lines the commits since the merge base added or modified", async () => {
  await featureBranch();
  await write(
    dir(),
    "a.ts",
    "const a = 1;\nconst B = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n",
  );
  await write(dir(), "untracked.ts", "const u = 1;\n");
  expect(await changedLines(dir(), false, "main")).toEqual(
    new Map([
      [
        "a.ts",
        [
          { start: 2, end: 2 },
          { start: 4, end: 4 },
        ],
      ],
      ["b.ts", [{ start: 1, end: 2 }]],
      ["mode.ts", []],
    ]),
  );
});

test("changedLines without a ref reads the working tree, with an untracked file changed in full", async () => {
  await write(dir(), "a.ts", "const a = 1;\nconst b = 2;\n");
  await write(dir(), "kept.ts", "const k = 1;\n");
  await gitRepo(dir());
  await write(dir(), "a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  await write(dir(), "new.ts", "const n = 1;\n");
  expect(await changedLines(dir(), true)).toEqual(
    new Map<string, unknown>([
      ["a.ts", [{ start: 3, end: 3 }]],
      ["new.ts", "all"],
    ]),
  );
});

test("changedLines with both reads the working tree against the merge base", async () => {
  await featureBranch();
  await write(
    dir(),
    "a.ts",
    "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n",
  );
  await write(dir(), "untracked.ts", "const u = 1;\n");
  expect(await changedLines(dir(), true, "main")).toEqual(
    new Map<string, unknown>([
      ["a.ts", [{ start: 4, end: 5 }]],
      ["b.ts", [{ start: 1, end: 2 }]],
      ["mode.ts", []],
      ["untracked.ts", "all"],
    ]),
  );
});

test("changedLines rebases paths onto a root below the top level and drops the rest", async () => {
  await write(dir(), "pkg/a.ts", "const a = 1;\n");
  await write(dir(), "top.ts", "const t = 1;\n");
  await gitRepo(dir());
  await write(dir(), "pkg/a.ts", "const a = 1;\nconst a2 = 2;\n");
  await write(dir(), "pkg/new.ts", "const n = 1;\n");
  await write(dir(), "top.ts", "const t = 1;\nconst t2 = 2;\n");
  expect(await changedLines(path.join(dir(), "pkg"), true)).toEqual(
    new Map<string, unknown>([
      ["a.ts", [{ start: 2, end: 2 }]],
      ["new.ts", "all"],
    ]),
  );
});

test("changedLines with an unknown ref fails naming the ref", async () => {
  await gitRepo(dir());
  const failure = changedLines(dir(), false, "nope");
  await expect(failure).rejects.toThrow(CliError);
  await expect(failure).rejects.toThrow(/^git merge-base: .*nope/u);
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

test.runIf(process.platform === "win32")("underRoot treats another drive as outside", () => {
  expect(underRoot("C:\\work\\root", "D:\\other\\a.ts")).toBeUndefined();
});
