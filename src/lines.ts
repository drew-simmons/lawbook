import { splitLines } from "./files.ts";

/** A run of lines in a file, 1-based and inclusive at both ends. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * The lines a change added or modified in one file, or `all` for a file
 * git has no earlier version of, such as an untracked one.
 */
export type ChangedLines = LineRange[] | "all";

/** Which lines each changed file has, by root-relative path. */
export type ChangeMap = ReadonlyMap<string, ChangedLines>;

/** Whether `changed` says the file has lines to judge; with no map, every file does. */
export function isChanged(changed: ChangeMap | undefined, path: string): boolean {
  const lines = changed?.get(path);
  return changed === undefined || lines === "all" || (lines !== undefined && lines.length > 0);
}

/** The file's lines, with a final line end not counted as one more line. */
export function contentLines(content: string): string[] {
  return splitLines(content.replace(/\r?\n$/u, ""));
}

/** The ranges as such, with `all` as the one range covering the file. */
export function rangesOf(lines: ChangedLines, content: string): LineRange[] {
  return lines === "all" ? [{ start: 1, end: contentLines(content).length }] : lines;
}

/** Whether any range holds the line. */
export function inRanges(ranges: LineRange[], line: number): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

/** `3-5, 12`: each range as `start-end`, or the one line it holds. */
export function formatRanges(ranges: LineRange[]): string {
  return ranges
    .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`))
    .join(", ");
}

/** Each line of the content behind its number, so the model can name one. */
export function numberLines(content: string): string {
  const lines = contentLines(content);
  const width = `${lines.length}`.length;
  return lines.map((line, index) => `${`${index + 1}`.padStart(width)} | ${line}`).join("\n");
}

/** Git quotes a path holding a quote, a backslash, or a control character the C way; this reads it back. */
export function unquotePath(quoted: string): string {
  const bytes: number[] = [];
  for (const [, escape, plain] of quoted.matchAll(/\\(\\|"|[abfnrtv]|[0-7]{3})|([^\\])/gu)) {
    bytes.push(
      ...(escape === undefined ? Buffer.from(plain ?? "", "utf8") : [escapedByte(escape)]),
    );
  }
  return Buffer.from(bytes).toString("utf8");
}

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
};

/** The byte behind a C escape: a named one, an octal one, or the character itself. */
function escapedByte(escape: string): number {
  return (
    ESCAPES[escape] ?? (/^[0-7]{3}$/u.test(escape) ? parseInt(escape, 8) : escape.charCodeAt(0))
  );
}

/** Both sides of a `--no-renames` header name the same path, so it is the first half of the rest. */
function headerPath(line: string): string | undefined {
  const quoted = /^diff --git "a\/((?:[^"\\]|\\.)*)" /u.exec(line);
  if (quoted !== null) {
    return unquotePath(quoted[1] ?? "");
  }
  const rest = line.startsWith("diff --git a/") ? line.slice("diff --git a/".length) : undefined;
  return rest === undefined ? undefined : rest.slice(0, (rest.length - " b/".length) / 2);
}

/** The lines a hunk adds or modifies on the new side, from `@@ -a,b +c,d @@`; nothing for a pure deletion. */
function hunkRange(line: string): LineRange | undefined {
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
  if (hunk === null) {
    return undefined;
  }
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  return count === 0 ? undefined : { start, end: start + count - 1 };
}

/**
 * The added and modified lines of each file in a `git diff -U0` patch, by
 * the path git prints, which is relative to the repository's top level. A
 * file with a header and no hunk, such as a mode change or a deletion, is
 * listed with no lines.
 */
export function parseHunks(patch: string): Map<string, LineRange[]> {
  const changes = new Map<string, LineRange[]>();
  let current: LineRange[] | undefined;
  for (const line of patch.split("\n")) {
    const path = headerPath(line);
    if (path !== undefined) {
      current = [];
      changes.set(path, current);
      continue;
    }
    const range = hunkRange(line);
    if (range !== undefined) {
      current?.push(range);
    }
  }
  return changes;
}
