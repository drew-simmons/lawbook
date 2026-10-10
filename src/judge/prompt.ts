import type { SourceFile } from "../files.ts";
import { formatRanges, type LineRange, numberLines } from "../lines.ts";
import type { JudgeRequest } from "./judge.ts";

/** The prompt every provider sends: the same words, whatever carries them. */
export const SYSTEM_PROMPT = `You review one or more files against one written standard.

Give the probability, from 0 to 1, that the files meet the standard. Judge
only what the standard says: a file that has other problems still meets the
standard when the standard is met, and a file the standard does not apply to
meets it. Base the probability on the files alone. When several files are
given, judge whether they meet the standard together.

Calibrate the number. 1 means the files plainly meet the standard and 0
means they plainly do not. 0.5 means the files give no way to tell. Use
values in between when the evidence is mixed, and stay away from 0 and 1
unless the files leave no doubt.

In the reason, cite the evidence in one or two sentences, naming the file
and quoting the relevant line when that helps the reader find it.`;

/**
 * How to answer, for a CLI with no structured-output flag: Claude Code and
 * Codex take the answer schema as an argument, Kiro reads it here.
 */
export const ANSWER_INSTRUCTION = `Answer with one JSON object and nothing else, shaped like {"noul": <number from 0 to 1>, "reason": "<one or two sentences citing the evidence>", "line": <the number of the line that shows the files fall short, only when the lines are numbered and they do>}.`;

/** What the model is told when a request names changed lines: judge those, read the rest. */
export const CHANGED_LINES_PROMPT = `Each file names the lines a change added or modified and numbers every line. Judge whether the changed lines meet the standard. The rest of the file is reference material: read it to understand the changed lines, and do not count what it does or fails to do against them. When the changed lines fall short, give the number of the line that shows it.`;

/** `File: <path>`, the changed lines, and the content with every line numbered. */
function changedBlock(file: SourceFile, ranges: LineRange[]): string {
  return `File: ${file.path}\nChanged lines: ${formatRanges(ranges)}\n\n${numberLines(file.content)}`;
}

/** `File: <path>` and the content, one block per file, blank-line separated; a file with changed lines names them and numbers its lines. */
export function fileBlocks(files: SourceFile[], changed?: Record<string, LineRange[]>): string {
  return files
    .map((file) => {
      const ranges = changed?.[file.path];
      return ranges === undefined
        ? `File: ${file.path}\n\n${file.content}`
        : changedBlock(file, ranges);
    })
    .join("\n\n");
}

/** What messages call the request: the one file's path, or how many files there were. */
export function requestLabel(request: JudgeRequest): string {
  const paths = request.files.map((file) => file.path);
  return paths.length === 1 ? paths.join("") : `${paths.length} files`;
}

/** The reference files as one block the model reads but does not judge, or nothing. */
export function contextBlock(context: SourceFile[] | undefined): string[] {
  return context === undefined || context.length === 0
    ? []
    : [
        `Reference material. Use it to understand the standard; judge only the files in the message, not these.\n\n${fileBlocks(context)}`,
      ];
}

/** The instruction for a request that names changed lines, or nothing. */
export function changedLinesBlock(request: JudgeRequest): string[] {
  return request.changed === undefined ? [] : [CHANGED_LINES_PROMPT];
}

/** The system prompt, the standard, any reference material, and how changed lines are judged: the same for every file in a rule. */
export function systemTexts(request: JudgeRequest): string[] {
  return [
    SYSTEM_PROMPT,
    `Standard:\n${request.standard}`,
    ...contextBlock(request.context),
    ...changedLinesBlock(request),
  ];
}
