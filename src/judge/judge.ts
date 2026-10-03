import { z } from "zod";
import type { LlmConfig, Provider } from "../config.ts";
import type { SourceFile } from "../files.ts";

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
 * description, not as a schema constraint, because the Messages API rejects
 * numeric constraints in structured outputs.
 */
export const answerSchema = z.object({
  noul: z.number().describe("probability, from 0 to 1, that the files meet the standard"),
  reason: z.string().describe("one or two sentences citing the evidence"),
});

export type Answer = z.infer<typeof answerSchema>;

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
  usage: Usage;
  /** True when the verdict came from lawbook's verdict cache, so `usage` is zero. */
  cached?: boolean;
}

export interface JudgeRequest {
  /** The standard in prose, from the rule. */
  standard: string;
  /** The files judged together: one for a `scope: file` rule, all of them for `scope: set`. */
  files: SourceFile[];
}

/** Applies a standard to one or more files. Providers implement it; tests fake it. */
export interface Judge {
  judge(request: JudgeRequest): Promise<Verdict>;
}

/** Builds the judge for one provider. Called once per `check` run, only when needed. */
export type JudgeFactory = (llm: LlmConfig) => Promise<Judge>;

export type Judges = Record<Provider, JudgeFactory>;
