import type { SourceFile } from "../files.ts";
import type { JudgeRequest } from "./judge.ts";

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

/** `File: <path>` and the content, one block per file, blank-line separated. */
export function fileBlocks(files: SourceFile[]): string {
  return files.map((file) => `File: ${file.path}\n\n${file.content}`).join("\n\n");
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

/** The system prompt, the standard, and any reference material: the same for every file in a rule. */
export function systemTexts(request: JudgeRequest): string[] {
  return [SYSTEM_PROMPT, `Standard:\n${request.standard}`, ...contextBlock(request.context)];
}
