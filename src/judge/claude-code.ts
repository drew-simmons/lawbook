import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CliError } from "../errors.ts";
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

export const CLAUDE_COMMAND = "claude";

/** As much of the `--output-format json` result as lawbook reads. */
const envelopeSchema = z
  .object({
    is_error: z.boolean().default(false),
    subtype: z.string().default("success"),
    result: z.string().default(""),
    structured_output: z.unknown().optional(),
    usage: z
      .object({
        input_tokens: z.number().default(0),
        output_tokens: z.number().default(0),
        cache_read_input_tokens: z.number().default(0),
        cache_creation_input_tokens: z.number().default(0),
      })
      .loose()
      .prefault({}),
  })
  .loose();

type Envelope = z.infer<typeof envelopeSchema>;

/**
 * The arguments for one request: print mode with a schema-shaped result,
 * the prompt from `systemFile`, and nothing the files could trigger: no
 * built-in tools, no MCP servers, no slash commands, no saved session.
 * `--bare` is left out on purpose: bare mode never reads the subscription
 * login, which is the point of this provider.
 */
export function claudeArgs(model: string, systemFile: string): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(answerJsonSchema()),
    "--system-prompt-file",
    systemFile,
    "--model",
    model,
    "--tools",
    "",
    "--disallowedTools",
    "mcp__*",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
}

/** The CLI's counts in lawbook's names. */
export function toClaudeUsage(usage: Envelope["usage"]): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  };
}

/** The result envelope when `stdout` holds one. */
function tryEnvelope(stdout: string): Envelope | undefined {
  try {
    return envelopeSchema.parse(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}

/** The result envelope, or an error quoting what the CLI printed instead. */
function parseEnvelope(stdout: string): Envelope {
  const envelope = tryEnvelope(stdout);
  if (envelope === undefined) {
    throw new CliError(`claude-code: unexpected output: ${stdout.trim().slice(0, 200)}`);
  }
  return envelope;
}

/**
 * A run that exited with an error: the CLI prints a failure inside the run,
 * such as a missing login, as the result and exits non-zero, so that text
 * is the reason when there is one; else the spawn error says what happened.
 */
export function translateClaudeError(error: unknown): never {
  const envelope = tryEnvelope(execFailure(error)?.stdout ?? "");
  if (envelope !== undefined) {
    throw new CliError(`claude-code: ${envelope.result || envelope.subtype}`);
  }
  return translateExecError(error, "claude-code", CLAUDE_COMMAND);
}

/** The verdict in the CLI's output, or an error: the run failed, or the result fits no answer. */
export function toClaudeVerdict(stdout: string, label: string): Verdict {
  const envelope = parseEnvelope(stdout);
  if (envelope.is_error || envelope.subtype !== "success") {
    throw new CliError(`claude-code: ${envelope.result || envelope.subtype}`);
  }
  return {
    ...parseAnswer(envelope.structured_output, label),
    usage: toClaudeUsage(envelope.usage),
  };
}

/**
 * Judges by running `claude -p` once per request in an empty directory, so
 * neither the checked project's `CLAUDE.md`, hooks, and MCP servers nor
 * its files reach the judge except through the prompt. The system prompt
 * goes through a file because reference material can outgrow an argument.
 */
export function claudeCodeJudge(model: string, exec: Exec = defaultExec): Judge {
  return {
    judge: (request: JudgeRequest) =>
      inScratchDir(async (dir) => {
        const systemFile = path.join(dir, "system.txt");
        await writeFile(systemFile, systemTexts(request).join("\n\n"));
        const { stdout } = await exec(
          CLAUDE_COMMAND,
          claudeArgs(model, systemFile),
          fileBlocks(request.files),
          dir,
        ).catch(translateClaudeError);
        return toClaudeVerdict(stdout, requestLabel(request));
      }),
  };
}
