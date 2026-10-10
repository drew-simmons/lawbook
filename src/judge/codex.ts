import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CliError, errorMessage } from "../errors.ts";
import { defaultExec, type Exec, execFailure, inScratchDir, translateExecError } from "./cli.ts";
import {
  answerJsonSchema,
  type Judge,
  type JudgeRequest,
  parseAnswer,
  type Usage,
  type Verdict,
} from "./judge.ts";
import { fileBlocks, requestLabel, systemTexts } from "./prompt.ts";

export const CODEX_COMMAND = "codex";

/** What `codex exec --json` prints per line, as much of it as lawbook reads. */
const eventSchema = z
  .object({
    type: z.string(),
    usage: z
      .object({
        input_tokens: z.number().default(0),
        cached_input_tokens: z.number().default(0),
        output_tokens: z.number().default(0),
      })
      .loose()
      .optional(),
    error: z.object({ message: z.string() }).loose().optional(),
    message: z.string().optional(),
  })
  .loose();

export type CodexEvent = z.infer<typeof eventSchema>;

/**
 * The arguments for one request: a non-interactive run in the scratch
 * directory, the prompt from stdin, the final message shaped by the answer
 * schema and written to a file, and events on stdout for the token counts.
 * Nothing is persisted, the sandbox is read-only, and no project's
 * execpolicy rules load.
 */
export function codexArgs(model: string, dir: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "-C",
    dir,
    "-m",
    model,
    "--output-schema",
    path.join(dir, "schema.json"),
    "-o",
    path.join(dir, "answer.json"),
    "--json",
    "-",
  ];
}

/** `codex exec` takes one prompt, so the system texts come first, then the files. */
export function codexPrompt(request: JudgeRequest): string {
  return [...systemTexts(request), fileBlocks(request.files, request.changed)].join("\n\n");
}

/** The lines of stdout that parse as events; anything else is noise. */
export function codexEvents(stdout: string): CodexEvent[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      const event = eventSchema.safeParse(JSON.parse(line));
      return event.success ? [event.data] : [];
    } catch {
      return [];
    }
  });
}

/** The API's own message when Codex quotes an error body as JSON, else the message as is. */
function unwrapMessage(message: string): string {
  try {
    const inner: unknown = JSON.parse(message);
    const nested = z.object({ error: z.object({ message: z.string() }) }).safeParse(inner);
    return nested.success ? nested.data.error.message : message;
  } catch {
    return message;
  }
}

/** Why the run failed, from a `turn.failed` or `error` event, or nothing when it did not. */
export function codexFailure(events: CodexEvent[]): string | undefined {
  const failed = events.find((event) => event.type === "turn.failed" || event.type === "error");
  return failed === undefined
    ? undefined
    : unwrapMessage(failed.error?.message ?? failed.message ?? failed.type);
}

/**
 * A run that exited with an error: when its events say why, that is the
 * reason; else the spawn error says what happened.
 */
export function translateCodexError(error: unknown): never {
  const failure = codexFailure(codexEvents(execFailure(error)?.stdout ?? ""));
  if (failure !== undefined) {
    throw new CliError(`codex: ${failure}`);
  }
  return translateExecError(error, "codex", CODEX_COMMAND);
}

/** Codex counts cached tokens inside `input_tokens`; lawbook reports them apart, like the other providers. */
export function toCodexUsage(events: CodexEvent[]): Usage {
  const usage = events.findLast((event) => event.type === "turn.completed")?.usage;
  const cached = usage?.cached_input_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) - cached,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: 0,
  };
}

/** The final message Codex wrote, parsed, or an error when it wrote none or not JSON. */
async function readAnswer(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw new CliError(`the judge gave no verdict for ${label} (${errorMessage(error)})`);
  }
}

/** The verdict from a finished run's events and answer file. */
export async function toCodexVerdict(stdout: string, dir: string, label: string): Promise<Verdict> {
  const events = codexEvents(stdout);
  const failure = codexFailure(events);
  if (failure !== undefined) {
    throw new CliError(`codex: ${failure}`);
  }
  const answer = await readAnswer(path.join(dir, "answer.json"), label);
  return { ...parseAnswer(answer, label), usage: toCodexUsage(events) };
}

/**
 * Judges by running `codex exec` once per request in an empty directory, so
 * neither the checked project's `AGENTS.md` nor its files reach the judge
 * except through the prompt.
 */
export function codexJudge(model: string, exec: Exec = defaultExec): Judge {
  return {
    judge: (request: JudgeRequest) =>
      inScratchDir(async (dir) => {
        await writeFile(path.join(dir, "schema.json"), JSON.stringify(answerJsonSchema()));
        const { stdout } = await exec(
          CODEX_COMMAND,
          codexArgs(model, dir),
          codexPrompt(request),
          dir,
        ).catch(translateCodexError);
        return toCodexVerdict(stdout, dir, requestLabel(request));
      }),
  };
}
