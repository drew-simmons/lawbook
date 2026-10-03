/** Which rule ids a file's lawbook comments turn off, for the whole file or per line. */
export interface Suppressions {
  file: Set<string>;
  /** Keyed by 1-based line number. */
  lines: Map<number, Set<string>>;
}

/** `lawbook-disable-next-line a, b` anywhere on a line; also `-line` and `-file`. */
const MARKER = /lawbook-disable-(next-line|line|file)\s+([\w-]+(?:\s*,\s*[\w-]+)*)/gu;

type Target = "next-line" | "line" | "file";

function ids(list: string): string[] {
  return list.split(",").map((id) => id.trim());
}

function addLine(lines: Map<number, Set<string>>, line: number, found: string[]): void {
  const set = lines.get(line) ?? new Set<string>();
  for (const id of found) {
    set.add(id);
  }
  lines.set(line, set);
}

const APPLY: Record<Target, (marks: Suppressions, line: number, found: string[]) => void> = {
  file: (marks, _line, found) => {
    for (const id of found) {
      marks.file.add(id);
    }
  },
  line: (marks, line, found) => addLine(marks.lines, line, found),
  "next-line": (marks, line, found) => addLine(marks.lines, line + 1, found),
};

/** Every marker in `content`, applied to the file or the line it names. */
export function parseSuppressions(content: string): Suppressions {
  const marks: Suppressions = { file: new Set(), lines: new Map() };
  content.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(MARKER)) {
      APPLY[match[1] as Target](marks, index + 1, ids(match[2] ?? ""));
    }
  });
  return marks;
}

function lineSuppressed(marks: Suppressions, id: string, line: number | undefined): boolean {
  return line !== undefined && marks.lines.get(line)?.has(id) === true;
}

/** Whether `id` is turned off for the whole file, or for `line` when one is given. */
export function suppressed(marks: Suppressions, id: string, line?: number): boolean {
  return marks.file.has(id) || lineSuppressed(marks, id, line);
}
