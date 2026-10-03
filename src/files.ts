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

export async function readSourceFile(root: string, file: string): Promise<SourceFile> {
  return { path: file, content: await readFile(path.join(root, file), "utf8") };
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
