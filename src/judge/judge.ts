import { z } from "zod";
import type { LlmConfig, Provider } from "../config.ts";

/**
 * Decisions follow the Jev decision schema (TypeSafe's System One API), so a
 * report reads the same whether a rule asks a yes/no, pick-one, or scored
 * question. Only `noul` is produced today.
 */

/** Jev's yes/no answer: the probability, 0..1, that the statement is true. */
export const noulDecisionSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

/** Jev's pick-one answer. No rule produces it yet. */
export const choiceDecisionSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

/** Jev's answer on an ordered scale. No rule produces it yet. */
export const scoreDecisionSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const decisionSchema = z.discriminatedUnion("type", [
  noulDecisionSchema,
  choiceDecisionSchema,
  scoreDecisionSchema,
]);

export type NoulDecision = z.infer<typeof noulDecisionSchema>;
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

/** A `standard` rule is a noul question. `reason` is lawbook's evidence; Jev has none. */
export interface Verdict {
  decision: NoulDecision;
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
