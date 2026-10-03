import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";

/** A file a rule looks at, with its path relative to the root. */
export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Files under `root` that match any of `patterns` and none of `ignore`,
 * as sorted root-relative paths with forward slashes. Dotfiles count. With
 * `candidates`, only files in that set are kept.
 */
export async function selectFiles(
  root: string,
  patterns: string[],
  ignore: string[],
  candidates?: ReadonlySet<string>,
): Promise<string[]> {
  const files = await glob(patterns, {
    cwd: root,
    ignore,
    dot: true,
    onlyFiles: true,
    expandDirectories: false,
  });
  const selected = candidates === undefined ? files : files.filter((file) => candidates.has(file));
  return selected.toSorted();
}

/**
 * `file`, given relative to the current directory or absolute, as a path
 * relative to `root` with forward slashes; undefined when it lies outside.
 */
export function underRoot(root: string, file: string): string | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`);
  return outside ? undefined : relative.split(path.sep).join("/");
}

/** How many leading bytes are checked for a NUL, which marks a binary file. */
export const BINARY_PROBE_BYTES = 8192;

export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/** The file as UTF-8 text, or undefined for a binary file, which no rule reads. */
export async function readSourceFile(root: string, file: string): Promise<SourceFile | undefined> {
  const buffer = await readFile(path.join(root, file));
  return isBinary(buffer) ? undefined : { path: file, content: buffer.toString("utf8") };
}

/** The globs a `files` rule selects with and the globs it leaves out. */
export interface FileSelection {
  files: string[];
  exclude: string[];
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
