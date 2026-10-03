import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { glob, isDynamicPattern } from "tinyglobby";

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
  // On another drive, `relative` comes back absolute.
  const outside =
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return outside ? undefined : relative.split(path.sep).join("/");
}

/** The lines of a file, whether it ends them with LF or CRLF. */
export function splitLines(content: string): string[] {
  return content.split(/\r?\n/u);
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

/** The literal paths that exist under `root`, as written; a directory counts. */
async function existingLiterals(root: string, literals: string[]): Promise<string[]> {
  const found = await Promise.all(literals.map((file) => pathExists(path.join(root, file))));
  return literals.filter((_file, index) => found[index] === true);
}

/**
 * The root-relative paths `patterns` name: a literal path when it exists,
 * file or directory, plus every file a glob selects outside `ignore`.
 * Sorted, without duplicates.
 */
export async function matchPaths(
  root: string,
  patterns: string[],
  ignore: string[],
): Promise<string[]> {
  const globs = patterns.filter((pattern) => isDynamicPattern(pattern));
  const literals = patterns.filter((pattern) => !isDynamicPattern(pattern));
  const [found, selected] = await Promise.all([
    existingLiterals(root, literals),
    globs.length === 0 ? [] : selectFiles(root, globs, ignore),
  ]);
  return [...new Set([...found, ...selected])].toSorted();
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
