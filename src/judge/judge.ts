import { z } from "zod";
import type { LlmConfig, Provider } from "../config.ts";
import { CliError } from "../errors.ts";
import type { SourceFile } from "../files.ts";
import type { LineRange } from "../lines.ts";

/**
 * A decision in the Jev decision schema (TypeSafe's System One API). A
 * `standard` rule asks a yes/no question, which Jev calls a noul: the
 * probability, 0..1, that the file meets the standard.
 */
export const decisionSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

export type Decision = z.infer<typeof decisionSchema>;

/**
 * What the model answers for one request. The range is stated in the
 * description, not as a schema constraint, because the schema goes to the
 * model as a tool's input schema and the Messages API rejects numeric
 * constraints there.
 */
export const answerSchema = z.object({
  noul: z.number().describe("probability, from 0 to 1, that the files meet the standard"),
  reason: z.string().describe("one or two sentences citing the evidence"),
  line: z
    .number()
    .optional()
    .describe(
      "when the message numbers the lines and the files fall short, the number of the line that shows it",
    ),
});

export type Answer = z.infer<typeof answerSchema>;

/** The model's probability as a noul decision, or an error when it is out of range. */
export function decisionOf(noul: number, path: string): Decision {
  const decision = decisionSchema.safeParse({ type: "noul", noul });
  if (!decision.success) {
    throw new CliError(`the judge gave an out-of-range probability ${noul} for ${path}`);
  }
  return decision.data;
}

/** The answer's shape as JSON Schema, for a tool's input schema or a CLI's structured-output flag. */
export function answerJsonSchema(): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(answerSchema);
  return schema;
}

/** What a verdict says beyond its cost: the decision, the reason, and the line the reason cites when it names one. */
export type Answered = Pick<Verdict, "decision" | "reason" | "line">;

/** A parsed answer as a noul decision and reason, or an error naming why it is not one. */
export function parseAnswer(value: unknown, label: string): Answered {
  const answer = answerSchema.safeParse(value);
  if (!answer.success) {
    throw new CliError(
      `the judge gave no verdict for ${label} (${z.prettifyError(answer.error).replaceAll("\n", "; ")})`,
    );
  }
  const { noul, reason, line } = answer.data;
  return { decision: decisionOf(noul, label), reason, ...(line === undefined ? {} : { line }) };
}

/** What one request cost, as the provider counts tokens. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens the provider read from its cache. */
  cacheReadInputTokens: number;
  /** Prompt tokens the provider wrote to its cache. */
  cacheCreationInputTokens: number;
}

export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** The decision on one request. `reason` is lawbook's evidence; Jev has none. */
export interface Verdict {
  decision: Decision;
  reason: string;
  /** The line the reason cites, when the request numbered the lines and the model named one. */
  line?: number;
  usage: Usage;
  /** True when the verdict came from lawbook's verdict cache, so `usage` is zero. */
  cached?: boolean;
}

export interface JudgeRequest {
  /** The standard in prose, from the rule. */
  standard: string;
  /** The files judged together: one for a `scope: file` rule, all of them for `scope: set`. */
  files: SourceFile[];
  /** Reference material the model reads but does not judge, such as a style guide. */
  context?: SourceFile[];
  /** The lines to judge in each file, by path; the rest of the file is reference. Set under `--changed-lines`. */
  changed?: Record<string, LineRange[]>;
}

/** Applies a standard to one or more files. Providers implement it; tests fake it. */
export interface Judge {
  judge(request: JudgeRequest): Promise<Verdict>;
}

/** Builds the judge for one provider. Called once per `check` run, only when needed. */
export type JudgeFactory = (llm: LlmConfig) => Promise<Judge>;

export type Judges = Record<Provider, JudgeFactory>;
