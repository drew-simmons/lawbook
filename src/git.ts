import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError, cliErrorMessage, errorMessage } from "./errors.ts";
import { type ChangedLines, parseHunks } from "./lines.ts";

const run = promisify(execFile);

/** What `execFile` rejects with when git exits non-zero. */
interface GitFailure {
  stderr?: string;
}

/** Runs git in `root` and returns its stdout. A failure is a `CliError` carrying git's stderr. */
export async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = (error as GitFailure).stderr?.trim();
    throw new CliError(`git ${args[0]}: ${stderr || errorMessage(error)}`);
  }
}

/** The NUL-separated paths git prints under `-z`. */
function splitPaths(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

/** `file` with `prefix` removed, or nothing when it lies outside the prefix. */
function underPrefix(prefix: string, file: string): string[] {
  return file.startsWith(prefix) ? [file.slice(prefix.length)] : [];
}

/**
 * Staged, unstaged, and untracked paths against HEAD. Porcelain entries are
 * `XY path`, so the path starts at column 3; `--no-renames` keeps a rename
 * as a delete and an add, so every entry has exactly one path.
 */
async function workingTreeChanges(root: string): Promise<string[]> {
  const output = await git(root, [
    "status",
    "--porcelain",
    "-z",
    "--no-renames",
    "--untracked-files=all",
  ]);
  return splitPaths(output).map((entry) => entry.slice(3));
}

/** Paths committed since the merge base with `ref`. */
async function committedSince(root: string, ref: string): Promise<string[]> {
  return splitPaths(
    await git(root, ["diff", "--name-only", "-z", "--no-renames", `${ref}...HEAD`]),
  );
}

/**
 * Files changed under `root`, as sorted root-relative paths with forward
 * slashes. Without `ref`, the working tree's staged, unstaged, and untracked
 * files against HEAD; with one, the files committed since the merge base
 * with `ref`. Git reports paths from the repository's top level, so paths
 * outside `root` are dropped and the rest are made relative to it.
 */
export async function changedFiles(root: string, ref?: string): Promise<string[]> {
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const files =
    ref === undefined ? await workingTreeChanges(root) : await committedSince(root, ref);
  return files.flatMap((file) => underPrefix(prefix, file)).toSorted();
}

/** The commit `ref` and `HEAD` branched from. */
async function mergeBase(root: string, ref: string): Promise<string> {
  return (await git(root, ["merge-base", ref, "HEAD"])).trim();
}

/** Untracked files `.gitignore` does not cover, under `root` and relative to it. */
async function untrackedFiles(root: string): Promise<string[]> {
  return splitPaths(await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]));
}

/**
 * The `git diff -U0` patch from `base` to `HEAD`, or to the working tree
 * when `tree` is set. Quoting is off so a path with non-ASCII characters
 * prints as it is; one with a quote or control character is still quoted.
 */
function hunkPatch(root: string, base: string, tree: boolean): Promise<string> {
  const to = tree ? [] : ["HEAD"];
  return git(root, ["-c", "core.quotePath=false", "diff", "-U0", "--no-renames", base, ...to]);
}

/**
 * The lines changed in each file under `root`, keyed like `changedFiles`
 * and over the same changes: with `since`, the commits since the merge
 * base with it; with `changed`, the working tree, where an untracked file
 * counts as changed in full; with both, the working tree against the merge
 * base, so a file changed both in a commit and since is numbered as it is
 * on disk. A file with no changed lines, such as a mode change, is listed
 * with none.
 */
export async function changedLines(
  root: string,
  changed: boolean,
  since?: string,
): Promise<Map<string, ChangedLines>> {
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const base = since === undefined ? "HEAD" : await mergeBase(root, since);
  const lines = rebasedHunks(prefix, await hunkPatch(root, base, changed));
  for (const file of changed ? await untrackedFiles(root) : []) {
    lines.set(file, "all");
  }
  return lines;
}

/** The patch's files with `prefix` removed, as `changedFiles` rebases paths; files outside it are dropped. */
function rebasedHunks(prefix: string, patch: string): Map<string, ChangedLines> {
  const lines = new Map<string, ChangedLines>();
  for (const [file, ranges] of parseHunks(patch)) {
    for (const path of underPrefix(prefix, file)) {
      lines.set(path, ranges);
    }
  }
  return lines;
}

/**
 * Tracked files, plus untracked files `.gitignore` does not cover, under
 * `root` and relative to it, sorted; undefined when `root` is not inside a
 * git work tree. One git call decides both questions.
 */
export async function listedFiles(root: string): Promise<string[] | undefined> {
  try {
    const output = await git(root, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
    return splitPaths(output).toSorted();
  } catch (error) {
    // Git refusing the directory is the "not a repository" answer; a bug still propagates.
    cliErrorMessage(error);
    return undefined;
  }
}
