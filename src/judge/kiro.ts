import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CliError } from "../errors.ts";
import { defaultExec, type Exec, execFailure, inScratchDir, translateExecError } from "./cli.ts";
import { type Judge, type JudgeRequest, NO_USAGE, parseAnswer, type Verdict } from "./judge.ts";
import { ANSWER_INSTRUCTION, fileBlocks, requestLabel, systemTexts } from "./prompt.ts";

export const KIRO_COMMAND = "kiro-cli";

/** The agent the scratch directory defines: lawbook's prompt, no tools, no MCP servers. */
export const AGENT_NAME = "lawbook";

/** Where Kiro looks for a workspace agent, relative to the directory it runs in. */
export const AGENT_FILE = path.join(".kiro", "agents", `${AGENT_NAME}.json`);

/** What `--output-format stream-json` prints per line, as much of it as lawbook reads. */
const eventSchema = z
  .object({
    type: z.string(),
    data: z
      .object({
        status: z.string().optional(),
        stopReason: z.string().optional(),
        finalText: z.string().optional(),
        /** A `runError` event's reason. */
        message: z.string().optional(),
      })
      .loose()
      .prefault({}),
  })
  .loose();

export type KiroEvent = z.infer<typeof eventSchema>;

/**
 * The arguments for one request: a non-interactive run that prints its
 * events as JSON Lines, trusts no tool, uses the agent the scratch directory
 * defines, and wraps nothing.
 */
export function kiroArgs(model: string): string[] {
  return [
    "chat",
    "--no-interactive",
    "--output-format",
    "stream-json",
    "--trust-tools=",
    "--agent",
    AGENT_NAME,
    "--model",
    model,
    "--wrap",
    "never",
  ];
}

/**
 * The agent file: Kiro has no system-prompt flag, so the prompt, the
 * standard, any reference material, and how to answer go in as the
 * agent's prompt. `tools` is empty and `includeMcpJson` false so nothing
 * runs; the files the agent reads come on stdin.
 */
export function kiroAgent(request: JudgeRequest): Record<string, unknown> {
  return {
    name: AGENT_NAME,
    description: "lawbook judge",
    prompt: [...systemTexts(request), ANSWER_INSTRUCTION].join("\n\n"),
    tools: [],
    includeMcpJson: false,
  };
}

/** The lines of stdout that parse as events; anything else is noise. */
export function kiroEvents(stdout: string): KiroEvent[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      const event = eventSchema.safeParse(JSON.parse(line));
      return event.success ? [event.data] : [];
    } catch {
      return [];
    }
  });
}

/** The text between the first `{` and the last `}`: the answer, whatever the model wrote around it. */
function jsonObjectIn(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end < start ? text : text.slice(start, end + 1);
}

/** The answer parsed out of the final text, or undefined when it holds no JSON. */
function parseFinalText(text: string): unknown {
  try {
    return JSON.parse(jsonObjectIn(text)) as unknown;
  } catch {
    return undefined;
  }
}

/** Why the run failed, from a `runError` event, or nothing when there is none. */
export function kiroFailure(events: KiroEvent[]): string | undefined {
  const failed = events.findLast((event) => event.type === "runError");
  return failed === undefined ? undefined : (failed.data.message ?? "the run failed");
}

/**
 * A run that exited with an error: when its events say why, that is the
 * reason; else the spawn error says what happened.
 */
export function translateKiroError(error: unknown): never {
  const failure = kiroFailure(kiroEvents(execFailure(error)?.stdout ?? ""));
  if (failure !== undefined) {
    throw new CliError(`kiro: ${failure}`);
  }
  return translateExecError(error, "kiro", KIRO_COMMAND);
}

/** The `runFinished` event's data, or an error: the run never finished, or finished badly. */
export function kiroOutcome(events: KiroEvent[]): KiroEvent["data"] {
  const finished = events.findLast((event) => event.type === "runFinished");
  if (finished === undefined) {
    throw new CliError(`kiro: ${kiroFailure(events) ?? "the run did not finish"}`);
  }
  if (finished.data.status !== "success") {
    throw new CliError(
      `kiro: ${finished.data.stopReason ?? finished.data.status ?? "the run failed"}`,
    );
  }
  return finished.data;
}

/**
 * The verdict in the event stream. Kiro meters credits, not tokens, so the
 * usage is zero.
 */
export function toKiroVerdict(stdout: string, label: string): Verdict {
  const outcome = kiroOutcome(kiroEvents(stdout));
  const answer = parseFinalText(outcome.finalText ?? "");
  return { ...parseAnswer(answer, label), usage: NO_USAGE };
}

/**
 * Judges by running `kiro-cli chat` once per request in an empty directory
 * that holds only the agent file, so neither the checked project's steering
 * nor its files reach the judge except through the prompt.
 */
export function kiroJudge(model: string, exec: Exec = defaultExec): Judge {
  return {
    judge: (request: JudgeRequest) =>
      inScratchDir(async (dir) => {
        const file = path.join(dir, AGENT_FILE);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(kiroAgent(request)));
        const { stdout } = await exec(
          KIRO_COMMAND,
          kiroArgs(model),
          fileBlocks(request.files, request.changed),
          dir,
        ).catch(translateKiroError);
        return toKiroVerdict(stdout, requestLabel(request));
      }),
  };
}
