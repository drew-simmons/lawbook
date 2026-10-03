import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError, errorMessage } from "./errors.ts";

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
