import { z } from "zod";
import type { LlmConfig, Provider } from "../config.ts";

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
 * What the model answers for one file. The range is stated in the
 * description, not as a schema constraint, because the Messages API rejects
 * numeric constraints in structured outputs.
 */
export const answerSchema = z.object({
  noul: z.number().describe("probability, from 0 to 1, that the file meets the standard"),
  reason: z.string().describe("one or two sentences citing the evidence"),
});

export type Answer = z.infer<typeof answerSchema>;

/** The decision on one file. `reason` is lawbook's evidence; Jev has none. */
export interface Verdict {
  decision: Decision;
  reason: string;
}

export interface JudgeRequest {
  /** The standard in prose, from the rule. */
  standard: string;
  /** The file's path relative to the checked directory. */
  path: string;
  content: string;
}

/** Applies a standard to one file. Providers implement it; tests fake it. */
export interface Judge {
  judge(request: JudgeRequest): Promise<Verdict>;
}

/** Builds the judge for one provider. Called once per `check` run, only when needed. */
export type JudgeFactory = (llm: LlmConfig) => Promise<Judge>;

export type Judges = Record<Provider, JudgeFactory>;
