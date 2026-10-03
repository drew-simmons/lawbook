import { z } from "zod";
import type { LlmConfig, Provider } from "../config.ts";

/** What the model answers for one file: whether it meets the standard, and why. */
export const verdictSchema = z.object({
  pass: z.boolean().describe("true when the file meets the standard"),
  reason: z.string().describe("one or two sentences citing the evidence"),
});

export type Verdict = z.infer<typeof verdictSchema>;

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
