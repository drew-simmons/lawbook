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
 * as sorted root-relative paths with forward slashes. Dotfiles count.
 */
export async function selectFiles(
  root: string,
  patterns: string[],
  ignore: string[],
): Promise<string[]> {
  const files = await glob(patterns, {
    cwd: root,
    ignore,
    dot: true,
    onlyFiles: true,
    expandDirectories: false,
  });
  return files.toSorted();
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
